import { describe, expect, it } from 'vitest'
import { runWorkflow as runWorkflowEngine } from './engine'
import type { ConditionCase, ConditionRule, WorkflowGraph, WorkflowNodeModel } from './types'

const edge = (sourceNodeId: string, sourcePort: string, targetNodeId: string) => ({ id: `${sourceNodeId}:${sourcePort}->${targetNodeId}`, sourceNodeId, sourcePort, targetNodeId })

function runWorkflow(graph: WorkflowGraph, inputPayload: unknown) {
  return runWorkflowEngine(graph, inputPayload)
}

function singleCase(conditions: ConditionRule[] = [{ fieldPath: 'request.body.tenant', valueType: 'string', operator: 'startsWith', value: 'vip-' }]): ConditionCase {
  return { id: 'case-1', name: '分支 1', logicalOperator: 'and', conditions }
}

type BaseNodeOverrides = {
  input?: Partial<Extract<WorkflowNodeModel, { kind: 'input' }>>
  control?: Partial<Extract<WorkflowNodeModel, { kind: 'control-input' }>>
  protocol?: Partial<Extract<WorkflowNodeModel, { kind: 'protocol-discovery' }>>
  condition?: Partial<Extract<WorkflowNodeModel, { kind: 'condition' }>>
  queueSelect?: Partial<Extract<WorkflowNodeModel, { kind: 'queue-select' }>>
}

function createBaseGraph(overrides?: BaseNodeOverrides): WorkflowGraph {
  const conditionNode: Extract<WorkflowNodeModel, { kind: 'condition' }> = {
    id: 'condition-gate', kind: 'condition', name: '租户准入判断', enabled: true, description: '仅放行 vip 租户', position: { x: 480, y: 120 }, cases: [singleCase()], ...overrides?.condition,
  }
  const controlNode: Extract<WorkflowNodeModel, { kind: 'control-input' }> = {
    id: 'control-input', kind: 'control-input', name: '控制输入', enabled: true, description: '注入系统控制值', position: { x: 250, y: 120 },
    controls: [{ id: 'feature-toggle', key: 'featureEnabled', label: '功能开关', kind: 'switch', enabled: true, defaultValue: true }], ...overrides?.control,
  }
  const queueSelectNode: Extract<WorkflowNodeModel, { kind: 'queue-select' }> = {
    id: 'queue-select', kind: 'queue-select', name: '队列选择', enabled: true, description: '选择逻辑队列', position: { x: 780, y: 120 }, queueIds: ['model-vip', 'model-default'], ...overrides?.queueSelect,
  }
  const nodes: WorkflowNodeModel[] = [
    { id: 'input', kind: 'input', name: '输入', enabled: true, description: '输入标准化', position: { x: 60, y: 120 }, ...overrides?.input }, controlNode,
    { id: 'protocol', kind: 'protocol-discovery', name: '协议发现', enabled: true, description: '识别请求协议并分发分支', position: { x: 250, y: 120 }, ...overrides?.protocol }, conditionNode, queueSelectNode,
    { id: 'output', kind: 'output', name: '输出', enabled: true, description: '路由结果输出', position: { x: 1050, y: 120 }, includeTrace: true, summaryLevel: 'detailed' },
  ]
  return { version: 1, nodes, edges: [
    edge('input', 'out', 'control-input'),
    edge('control-input', 'out', 'protocol'),
    edge('protocol', 'openai-completions', 'condition-gate'),
    edge('protocol', 'openai-responses', 'condition-gate'),
    edge('protocol', 'anthropic-messages', 'condition-gate'),
    edge('protocol', 'unknown', 'output'),
    edge('condition-gate', 'case-1', 'queue-select'),
    edge('condition-gate', 'else', 'output'),
    edge('queue-select', 'out', 'output'),
  ] }
}

describe('router engine', () => {
  it('normalizes protocol branch payloads with model and messages for downstream outputs', () => {
    const graph = createBaseGraph()

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hello world' }],
        },
      },
      metadata: { source: 'desktop' },
    })

    const normalized = (result.outputPayload as { metadata: { protocolOutput?: { protocol: string; model: string; messages: Array<{ role: string; content: unknown }> } } }).metadata.protocolOutput
    expect(normalized).toMatchObject({
      protocol: 'openai-completions',
      transport: 'http',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello world' }],
    })
  })

  it('detects http-sse transport and writes transport metadata', () => {
    const graph = createBaseGraph()

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: {
          'x-provider': 'openai',
          accept: 'text/event-stream',
        },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
          stream: true,
        },
      },
      metadata: {},
    })

    const payload = result.outputPayload as { metadata: { transport: string; protocolOutput: { transport: string } } }
    expect(payload.metadata.transport).toBe('http-sse')
    expect(payload.metadata.protocolOutput.transport).toBe('http-sse')
  })

  it('routes openai-completions requests through IF and resolver nodes', () => {
    const graph = createBaseGraph()

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: { source: 'desktop' },
    })

    expect(result.stopReason).toBe('output')
    expect(result.protocol).toBe('openai-completions')
    expect(result.queueSelections['queue-select']?.queueIds).toEqual(['model-vip', 'model-default'])
    expect(result.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)
  })

  it('injects control-input values into metadata for downstream conditions', () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{ 
          fieldPath: 'metadata.controls.featureEnabled',
          valueType: 'boolean',
          operator: 'isTrue',
        }])],
      },
      control: {
        controls: [
          {
            id: 'feature-toggle',
            key: 'featureEnabled',
            label: '功能开关',
            kind: 'switch',
            enabled: true,
            defaultValue: true,
          },
        ],
      },
    })

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'standard-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    const payload = result.outputPayload as { metadata: { controls: { featureEnabled: boolean } } }
    expect(payload.metadata.controls.featureEnabled).toBe(true)
    expect(result.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)
  })

  it('auto-detects anthropic-messages by model id without explicit rules', () => {
    const graph = createBaseGraph()

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/messages',
        headers: {},
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.protocol).toBe('anthropic-messages')
  })

  it('supports request.headers as string array when discovering protocol', () => {
    const graph = createBaseGraph()

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.protocol).toBe('openai-completions')
  })

  it('exposes requestModelInQueues for condition checks', () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{ 
          fieldPath: 'metadata.router.requestModelInQueues',
          valueType: 'boolean',
          operator: 'isTrue',
        }])],
      },
      queueSelect: {
        queueIds: ['queue-hit'],
      },
    })

    const hit = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: { tenant: 'any', model: 'queue-hit' },
      },
      queues: [
        { id: 'queue-hit', name: 'Queue Hit', enabled: true },
        { id: 'queue-fallback', name: 'Queue Fallback', enabled: true },
      ],
      metadata: {},
    })

    expect(hit.stopReason).toBe('output')
    expect(hit.queueSelections['queue-select']?.queueIds).toEqual(['queue-hit'])

    const payload = hit.outputPayload as { metadata: { router: { requestModelInQueues: boolean; queueIds: string[] } } }
    expect(payload.metadata.router.requestModelInQueues).toBe(true)
    expect(payload.metadata.router.queueIds).toEqual(['queue-hit', 'queue-fallback'])
  })

  it('exposes normalized protocol output fields for downstream conditions', () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([
          {
            fieldPath: 'metadata.protocolOutput.model',
            valueType: 'string',
            operator: 'equals',
            value: 'gpt-4o-mini',
          },
          {
            fieldPath: 'metadata.protocolOutput.messages',
            valueType: 'array',
            operator: 'notEmpty',
          },
        ])],
      },
    })

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hello world' }],
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)
  })

  it('sends unknown protocol directly to output branch', () => {
    const graph = createBaseGraph()

    const result = runWorkflow(graph, {
      request: {
        path: '/v2/unknown',
        headers: {},
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.protocol).toBe('unknown')
    expect(result.queueSelections).toEqual({})
  })

  it('保留条件命中后的队列选择结果', () => {
    const graph = createBaseGraph()

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'unknown-model',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.queueSelections['queue-select']?.queueIds).toEqual(['model-vip', 'model-default'])
  })

  it('保留队列选择节点的稳定结果', () => {
    const result = runWorkflow(createBaseGraph(), {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'model-vip',
        },
      },
      metadata: {},
    })

    expect(result.queueSelections['queue-select']?.queueIds).toEqual(['model-vip', 'model-default'])
  })

  it('returns an error when the input node is missing', () => {
    const graph = createBaseGraph()
    graph.nodes = graph.nodes.filter(node => node.kind !== 'input')

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('error')
    expect(result.queueSelections).toEqual({})
    expect(result.trace).toHaveLength(1)
    expect(result.trace[0]?.message).toBe('缺少输入节点')
  })

  it('skips a disabled protocol-discovery node and follows the unknown branch', () => {
    const graph = createBaseGraph({
      protocol: {
        enabled: false,

      },
    })

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.protocol).toBe('unknown')
    expect(result.queueSelections).toEqual({})
    expect(result.trace.some(item => item.nodeId === 'protocol' && item.message === '节点禁用，跳过')).toBe(true)
  })

  it('不生成旧 routeDecision 或 targetQueue 字段', () => {
    const graph = createBaseGraph()
    graph.edges = graph.edges.map(item => item.sourceNodeId === 'protocol' && item.sourcePort === 'unknown' ? { ...item, targetNodeId: 'condition-gate' } : item)

    const result = runWorkflow(graph, {
      request: {
        path: '/v2/unknown',
        headers: {},
        body: { tenant: 'vip-cn', model: 'gpt-4o-mini' },
      },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.queueSelections['queue-select']?.queueIds).toEqual(['model-vip', 'model-default'])
    expect(result).not.toHaveProperty('routeDecision')
    expect(result).not.toHaveProperty('targetQueue')
  })

  it('supports multiple IF branches with OR and ELSE fallback', () => {
    const graph = createBaseGraph({
      condition: {
        cases: [
          singleCase([{ fieldPath: 'request.body.tenant', valueType: 'string', operator: 'equals', value: 'vip-cn' }]),
          {
            id: 'case-2',
            name: '高优先级',
            logicalOperator: 'or',
            conditions: [
              { fieldPath: 'request.body.priority', valueType: 'number', operator: 'gte', value: '5' },
              { fieldPath: 'request.body.tenant', valueType: 'string', operator: 'equals', value: 'internal' },
            ],
          },
        ],
      },
    })

    graph.edges.push(edge('condition-gate', 'case-2', 'queue-select'))

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: { tenant: 'internal', priority: 1, model: 'gpt-4o-mini' },
      },
      metadata: {},
    })

    const conditionTrace = result.trace.find(item => item.nodeId === 'condition-gate')
    expect(result.stopReason).toBe('output')
    expect(conditionTrace?.success).toBe(true)
    expect(conditionTrace?.details).toMatchObject({ matchedCaseId: 'case-2' })
  })

  it('supports numeric between condition operator', () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{ 
          fieldPath: 'request.body.priority',
          valueType: 'number',
          operator: 'between',
          value: '1',
          secondaryValue: '3',
        }])],
      },
    })

    const pass = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          priority: 2,
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    const fail = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: {
          priority: 6,
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    expect(pass.queueSelections['queue-select']?.queueIds).toEqual(['model-vip', 'model-default'])
    expect(fail.queueSelections).toEqual({})
    expect(fail.trace.some(item => item.nodeId === 'condition-gate' && !item.success)).toBe(true)
  })

  it('迭代节点遍历数组并在完成后从 out 端口退出', () => {
    const nodes: WorkflowNodeModel[] = [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
      { id: 'queue-select', kind: 'queue-select', name: '队列选择', enabled: true, description: '', position: { x: 100, y: 0 }, queueIds: ['model-a', 'model-b'] },
      { id: 'control', kind: 'control-input', name: '下游', enabled: true, description: '', position: { x: 200, y: 0 }, controls: [] },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 300, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ]
    const result = runWorkflow({ version: 1, nodes, edges: [edge('input', 'out', 'queue-select'), edge('queue-select', 'out', 'control'), edge('control', 'out', 'output')] }, { request: { body: { items: ['a', 'b', 'c'] } }, metadata: {} })
    expect(result.stopReason).toBe('output')
    expect(result.queueSelections['queue-select']?.queueIds).toEqual(['model-a', 'model-b'])
    expect((result.outputPayload as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty('iteration')
  })

  it('队列选择节点去重并保持选择顺序', () => {
    const nodes: WorkflowNodeModel[] = [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
      { id: 'queue-select', kind: 'queue-select', name: '队列选择', enabled: true, description: '', position: { x: 100, y: 0 }, queueIds: ['model-a', 'model-a', 'model-b'] },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 300, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ]
    const result = runWorkflow({ version: 1, nodes, edges: [edge('input', 'out', 'queue-select'), edge('queue-select', 'out', 'output')] }, { request: { body: {} }, metadata: {} })
    expect(result.queueSelections['queue-select']?.queueIds).toEqual(['model-a', 'model-b'])
    expect((result.outputPayload as { queueIds: string[] }).queueIds).toEqual(['model-a', 'model-b'])
  })
})
