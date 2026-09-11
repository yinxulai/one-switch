import { describe, expect, it } from 'vitest'
import { runWorkflow } from './engine'
import { appendNode, cloneNode, connectEdge, insertNode, portKey, primarySourcePort, removeEdges, removeNode, resolveInsertAnchor } from './graph-ops'
import { createDefaultGraph, createDefaultPolicyGraph, createNodeByKind } from './graph-model'
import { APPENDABLE_KINDS } from './node-meta'
import { WorkflowGraphSchema } from './schemas'
import type { ConditionNode, ControlInputNode, WorkflowGraph, WorkflowNodeModel } from './types'

/**
 * 图操作回归测试。
 * 这些函数是画布与路由引擎之间唯一的写入口，任何改动都必须保持
 * 「一个 source 端口最多一条出边」这一引擎前提。
 */

function nodeById(graph: WorkflowGraph, nodeId: string): WorkflowNodeModel {
  const node = graph.nodes.find(item => item.id === nodeId)
  if (!node) throw new Error(`节点不存在：${nodeId}`)
  return node
}

function conditionOf(graph: WorkflowGraph): ConditionNode {
  const node = nodeById(graph, 'condition')
  if (node.kind !== 'condition') throw new Error('condition 节点类型不匹配')
  return node
}

function controlInputOf(graph: WorkflowGraph): ControlInputNode {
  const node = graph.nodes.find(item => item.kind === 'control-input')
  if (!node || node.kind !== 'control-input') throw new Error('control-input 节点不存在')
  return node
}

/** 校验引擎前提：同一个 source 端口上不允许出现多条出边。 */
function expectUniqueSourcePorts(graph: WorkflowGraph) {
  const keys = graph.edges.map(edge => portKey(edge.sourceNodeId, String(edge.sourcePort)))
  expect(new Set(keys).size).toBe(keys.length)
}

function withControlInput(): WorkflowGraph {
  const graph = createDefaultGraph()
  const control = createNodeByKind('control-input', { x: 80, y: 520 })
  return appendNode(graph, control)
}

describe('portKey', () => {
  it('把节点与端口拼成唯一的端口键', () => {
    expect(portKey('input', 'out')).toBe('input:out')
  })
})

describe('primarySourcePort', () => {
  it('输入 / 控制输入 / 逻辑模型选择都继续走 out', () => {
    const graph = withControlInput()
    expect(primarySourcePort(nodeById(graph, 'input'))).toBe('out')
    expect(primarySourcePort(nodeById(graph, 'model'))).toBe('out')
    expect(primarySourcePort(controlInputOf(graph))).toBe('out')
  })

  it('协议发现默认接兜底分支，条件节点默认接第一条 IF 分支', () => {
    const graph = createDefaultGraph()
    expect(primarySourcePort(nodeById(graph, 'protocol'))).toBe('unknown')
    expect(primarySourcePort(conditionOf(graph))).toBe(conditionOf(graph).cases[0].id)
  })

  it('出口节点没有可继续的端口', () => {
    expect(primarySourcePort(nodeById(createDefaultGraph(), 'output'))).toBeNull()
  })
})

describe('resolveInsertAnchor', () => {
  it('可以从连线 id 解析出上游端口与原下游', () => {
    const anchor = resolveInsertAnchor(createDefaultGraph(), { kind: 'condition', edgeId: 'edge-input-protocol' })
    expect(anchor).toEqual({ sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' })
  })

  it('连线不存在时返回 null', () => {
    expect(resolveInsertAnchor(createDefaultGraph(), { kind: 'condition', edgeId: 'edge-missing' })).toBeNull()
  })

  it('可以从端口插入请求解析锚点，并带上端口当前的下游', () => {
    const anchor = resolveInsertAnchor(createDefaultGraph(), { kind: 'model-select', prevNodeId: 'protocol', prevSourcePort: 'openai-completions' })
    expect(anchor).toEqual({ sourceNodeId: 'protocol', sourcePort: 'openai-completions', targetNodeId: 'condition' })
  })

  it('端口上没有出边时下游为空', () => {
    const anchor = resolveInsertAnchor(createDefaultGraph(), { kind: 'model-select', prevNodeId: 'condition', prevSourcePort: 'no-such-port' })
    expect(anchor).toEqual({ sourceNodeId: 'condition', sourcePort: 'no-such-port', targetNodeId: null })
  })

  it('上游节点不存在时返回 null', () => {
    expect(resolveInsertAnchor(createDefaultGraph(), { kind: 'model-select', prevNodeId: 'nope', prevSourcePort: 'out' })).toBeNull()
  })
})

describe('insertNode', () => {
  it('在端口后面插入节点：原连线被替换为 上游 → 新节点 → 原下游', () => {
    const graph = createDefaultGraph()
    const anchor = resolveInsertAnchor(graph, { kind: 'model-select', edgeId: 'edge-input-protocol' })
    expect(anchor).not.toBeNull()

    const inserted = createNodeByKind('model-select', { x: 240, y: 220 })
    const next = insertNode(graph, anchor!, inserted)

    expect(next.nodes).toHaveLength(graph.nodes.length + 1)
    expect(next.edges.some(edge => edge.id === 'edge-input-protocol')).toBe(false)
    expect(next.edges).toContainEqual({ id: `input:out->${inserted.id}`, sourceNodeId: 'input', sourcePort: 'out', targetNodeId: inserted.id })
    expect(next.edges).toContainEqual({ id: `${inserted.id}:out->protocol`, sourceNodeId: inserted.id, sourcePort: 'out', targetNodeId: 'protocol' })
    expectUniqueSourcePorts(next)
  })

  it('在末端端口插入时不会凭空接出下游', () => {
    const graph = appendNode(createDefaultGraph(), createNodeByKind('condition', { x: 1800, y: 220 }))
    const tail = graph.nodes[graph.nodes.length - 1]
    const anchor = { sourceNodeId: 'output', sourcePort: 'out', targetNodeId: null }
    const inserted = createNodeByKind('model-select', { x: 2000, y: 220 })

    const next = insertNode(graph, anchor, inserted)
    expect(next.edges.filter(edge => edge.sourceNodeId === 'output')).toHaveLength(1)
    expect(next.edges.filter(edge => edge.sourceNodeId === inserted.id)).toHaveLength(0)
    expect(nodeById(next, tail.id)).toBeDefined()
    expectUniqueSourcePorts(next)
  })

  it('插入条件节点后，续接端口使用第一条 IF 分支', () => {
    const graph = createDefaultGraph()
    const inserted = createNodeByKind('condition', { x: 240, y: 220 })
    const next = insertNode(graph, { sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' }, inserted)
    const condition = nodeById(next, inserted.id)
    if (condition.kind !== 'condition') throw new Error('condition 节点类型不匹配')

    expect(next.edges).toContainEqual({
      id: `${inserted.id}:${condition.cases[0].id}->protocol`,
      sourceNodeId: inserted.id,
      sourcePort: condition.cases[0].id,
      targetNodeId: 'protocol',
    })
  })
})

describe('appendNode', () => {
  it('只追加节点，不建立任何连线', () => {
    const graph = createDefaultGraph()
    const next = appendNode(graph, createNodeByKind('model-select', { x: 0, y: 0 }))
    expect(next.nodes).toHaveLength(graph.nodes.length + 1)
    expect(next.edges).toEqual(graph.edges)
  })
})

describe('removeNode', () => {
  it('被删节点只有一条出边时，上游直接接下游（穿透删除）', () => {
    const graph = createDefaultGraph()
    const next = removeNode(graph, 'model')

    expect(next.nodes.some(node => node.id === 'model')).toBe(false)
    expect(next.edges.some(edge => edge.sourceNodeId === 'model' || edge.targetNodeId === 'model')).toBe(false)
    expect(next.edges.filter(edge => edge.targetNodeId === 'output')).toHaveLength(3)
    expect(next.edges.find(edge => edge.sourceNodeId === 'condition' && edge.sourcePort === 'else')?.targetNodeId).toBe('output')
    expectUniqueSourcePorts(next)
  })

  it('被删节点有多条出边时，直接断开上游连线', () => {
    const graph = createDefaultGraph()
    const next = removeNode(graph, 'condition')

    expect(next.nodes.some(node => node.id === 'condition')).toBe(false)
    expect(next.edges.some(edge => edge.targetNodeId === 'condition')).toBe(false)
    expect(next.edges).toHaveLength(graph.edges.length - 5)
    expectUniqueSourcePorts(next)
  })

  it('删除不存在的节点时图为空操作', () => {
    const graph = createDefaultGraph()
    const next = removeNode(graph, 'not-exist')
    expect(next.nodes).toEqual(graph.nodes)
    expect(next.edges).toEqual(graph.edges)
  })
})

describe('cloneNode', () => {
  it('复制节点会换新 id 并偏移位置', () => {
    const graph = createDefaultGraph()
    const source = nodeById(graph, 'model')
    const cloned = cloneNode(source)

    expect(cloned.id).not.toBe(source.id)
    expect(cloned.kind).toBe(source.kind)
    expect(cloned.position).toEqual({ x: source.position.x + 48, y: source.position.y + 48 })
  })

  it('条件分支与控制项都会重新生成 id', () => {
    const graph = withControlInput()
    const condition = cloneNode(conditionOf(graph))
    const control = cloneNode(controlInputOf(graph))

    if (condition.kind !== 'condition') throw new Error('condition 节点类型不匹配')
    if (control.kind !== 'control-input') throw new Error('control-input 节点类型不匹配')

    expect(condition.cases).toHaveLength(1)
    expect(condition.cases[0].id).not.toBe(conditionOf(graph).cases[0].id)
    expect(control.controls).toHaveLength(1)
    expect(control.controls[0].id).not.toBe(controlInputOf(graph).controls[0].id)
  })
})

describe('connectEdge', () => {
  it('新增连线时追加一条端口独占的出边', () => {
    const graph = createDefaultGraph()
    const next = connectEdge(graph, 'condition', 'new-case', 'model')

    expect(next.edges.find(edge => edge.sourceNodeId === 'condition' && edge.sourcePort === 'new-case')?.targetNodeId).toBe('model')
    expectUniqueSourcePorts(next)
  })

  it('同一端口重复连接会改写目标而不是新增连线', () => {
    const graph = createDefaultGraph()
    const next = connectEdge(graph, 'input', 'out', 'output')

    expect(next.edges.filter(edge => edge.sourceNodeId === 'input' && edge.sourcePort === 'out')).toHaveLength(1)
    expect(next.edges.find(edge => edge.sourceNodeId === 'input')?.targetNodeId).toBe('output')
    expectUniqueSourcePorts(next)
  })

  it('自连接与重复连接都返回原图引用', () => {
    const graph = createDefaultGraph()
    expect(connectEdge(graph, 'input', 'out', 'input')).toBe(graph)
    expect(connectEdge(graph, 'input', 'out', 'protocol')).toBe(graph)
  })
})

describe('removeEdges', () => {
  it('按 id 删除连线', () => {
    const graph = createDefaultGraph()
    const next = removeEdges(graph, ['edge-input-protocol', 'edge-model-output'])
    expect(next.edges).toHaveLength(graph.edges.length - 2)
    expect(next.edges.some(edge => edge.id === 'edge-input-protocol')).toBe(false)
    expect(next.nodes).toEqual(graph.nodes)
  })
})

describe('图谱校验（回归）', () => {
  it('默认图本身必须通过 schema 校验', () => {
    expect(WorkflowGraphSchema.safeParse(createDefaultGraph()).error?.issues).toBeUndefined()
  })

  it('默认策略图由基础节点组合而成，同样必须通过 schema 校验', () => {
    const graph = createDefaultPolicyGraph()
    expect(WorkflowGraphSchema.safeParse(graph).error?.issues).toBeUndefined()
    // 规则完全由既有基础节点表达，没有任何专用节点类型。
    expect(new Set(graph.nodes.map(node => node.kind))).toEqual(new Set(['input', 'condition', 'model-select', 'output']))
    // 命中判断是一条普通的「字段 in 字段」条件，不是引擎预计算的布尔字段。
    const condition = graph.nodes.find(node => node.kind === 'condition')
    expect(condition?.cases[0].conditions[0]).toMatchObject({
      fieldPath: 'route.requestedModel',
      operator: 'in',
      valueSource: 'field',
      valueFieldPath: 'route.availableModelIds',
    })
  })

  it('旧图的 kind / mode / queueIds 会被迁移到 model-select', () => {
    const legacy = {
      version: 1,
      nodes: [
        { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
        { id: 'model', kind: 'queue-select', name: '模型选择', enabled: true, description: '', position: { x: 100, y: 0 }, mode: 'follow-request-model', queueIds: ['model-a'], fallbackQueueIds: ['default'] },
        { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 200, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
      ],
      edges: [
        { id: 'edge-input-model', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'model' },
        { id: 'edge-model-output', sourceNodeId: 'model', sourcePort: 'out', targetNodeId: 'output' },
      ],
    }

    const parsed = WorkflowGraphSchema.parse(legacy)
    const modelNode = parsed.nodes.find(node => node.kind === 'model-select')
    expect(modelNode).toMatchObject({
      source: 'variable',
      variablePath: 'route.requestedModel',
      modelIds: ['model-a'],
      fallbackModelIds: ['default'],
    })
    expect(modelNode).not.toHaveProperty('mode')
  })

  it('插入任意可新增节点后，图仍能通过 schema 校验', () => {
    for (const kind of APPENDABLE_KINDS) {
      const graph = createDefaultGraph()
      const anchor = resolveInsertAnchor(graph, { kind, edgeId: 'edge-input-protocol' })
      expect(anchor).not.toBeNull()

      const next = insertNode(graph, anchor!, createNodeByKind(kind, { x: 240, y: 220 }))
      // 一旦校验失败，缓存就会被丢弃、用户的改动会整张丢失，所以这里必须为空。
      expect({ kind, issues: WorkflowGraphSchema.safeParse(next).error?.issues }).toEqual({ kind, issues: undefined })
    }
  })
})

describe('图操作与引擎的协同', () => {
  it('在连线上插入节点后仍通过图校验，且引擎按新顺序经过它', () => {
    const graph = createDefaultGraph()
    const anchor = resolveInsertAnchor(graph, { kind: 'protocol-discovery', edgeId: 'edge-input-protocol' })
    expect(anchor).not.toBeNull()

    const inserted = createNodeByKind('protocol-discovery', { x: 240, y: 220 })
    const next = insertNode(graph, anchor!, inserted)

    expect(WorkflowGraphSchema.safeParse(next).error?.issues).toBeUndefined()

    const result = runWorkflow(next, { request: { body: {} }, metadata: {} })
    const visited = result.trace.map(step => step.nodeId)

    expect(visited).toContain(inserted.id)
    expect(visited.indexOf('input')).toBeLessThan(visited.indexOf(inserted.id))
    expect(visited.indexOf(inserted.id)).toBeLessThan(visited.indexOf('protocol'))
  })

  it('穿透删除中间节点后，引擎把上游直接接到下游', () => {
    const next = removeNode(createDefaultGraph(), 'model')
    const result = runWorkflow(next, { request: { body: {} }, metadata: {} })

    expect(result.stopReason).toBe('output')
    expect(result.trace.some(step => step.nodeId === 'model')).toBe(false)
    expect(result.trace[result.trace.length - 1].nodeId).toBe('output')
  })
})
