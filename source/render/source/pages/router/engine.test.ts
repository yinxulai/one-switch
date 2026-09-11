import { describe, expect, it } from 'vitest'
import { runWorkflow as runWorkflowEngine } from './engine'
import { createDefaultPolicyGraph } from './graph-model'
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
  modelSelect?: Partial<Extract<WorkflowNodeModel, { kind: 'model-select' }>>
}

function createBaseGraph(overrides?: BaseNodeOverrides): WorkflowGraph {
  const conditionNode: Extract<WorkflowNodeModel, { kind: 'condition' }> = {
    id: 'condition-gate', kind: 'condition', name: '租户准入判断', enabled: true, description: '仅放行 vip 租户', position: { x: 480, y: 120 }, cases: [singleCase()], ...overrides?.condition,
  }
  const controlNode: Extract<WorkflowNodeModel, { kind: 'control-input' }> = {
    id: 'control-input', kind: 'control-input', name: '控制输入', enabled: true, description: '注入系统控制值', position: { x: 250, y: 120 },
    controls: [{ id: 'feature-toggle', key: 'featureEnabled', label: '功能开关', kind: 'switch', enabled: true, defaultValue: true }], ...overrides?.control,
  }
  const modelSelectNode: Extract<WorkflowNodeModel, { kind: 'model-select' }> = {
    id: 'model-select', kind: 'model-select', name: '逻辑模型选择', enabled: true, description: '选择逻辑模型', position: { x: 780, y: 120 }, source: 'fixed', variablePath: '', modelIds: ['model-vip', 'model-default'], fallbackModelIds: [], ...overrides?.modelSelect,
  }
  const nodes: WorkflowNodeModel[] = [
    { id: 'input', kind: 'input', name: '输入', enabled: true, description: '输入标准化', position: { x: 60, y: 120 }, ...overrides?.input }, controlNode,
    { id: 'protocol', kind: 'protocol-discovery', name: '协议发现', enabled: true, description: '识别请求协议并分发分支', position: { x: 250, y: 120 }, ...overrides?.protocol }, conditionNode, modelSelectNode,
    { id: 'output', kind: 'output', name: '输出', enabled: true, description: '路由结果输出', position: { x: 1050, y: 120 }, includeTrace: true, summaryLevel: 'detailed' },
  ]
  return { version: 1, nodes, edges: [
    edge('input', 'out', 'control-input'),
    edge('control-input', 'out', 'protocol'),
    edge('protocol', 'openai-completions', 'condition-gate'),
    edge('protocol', 'openai-responses', 'condition-gate'),
    edge('protocol', 'anthropic-messages', 'condition-gate'),
    edge('protocol', 'unknown', 'output'),
    edge('condition-gate', 'case-1', 'model-select'),
    edge('condition-gate', 'else', 'output'),
    edge('model-select', 'out', 'output'),
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

    // 协议归一化的结果只进 trace 详情，不再写回 payload。
    const protocolTrace = result.trace.find(item => item.nodeId === 'protocol')
    expect(protocolTrace?.details).toMatchObject({
      normalized: {
        protocol: 'openai-completions',
        transport: 'http',
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hello world' }],
      },
    })
    // 调用方的 metadata 不被引擎改写。
    const payload = result.outputPayload as { metadata: Record<string, unknown> }
    expect(payload.metadata).toEqual({ source: 'desktop' })
  })

  it('detects http-sse transport and writes it into route', () => {
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

    const payload = result.outputPayload as { route: { protocol: string; transport: string } }
    expect(payload.route.transport).toBe('http-sse')
    expect(payload.route.protocol).toBe('openai-completions')
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
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
    expect(result.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)
  })

  it('injects control-input values into route.controls for downstream conditions', () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{ 
          fieldPath: 'route.controls.featureEnabled',
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

    const payload = result.outputPayload as { route: { controls: { featureEnabled: boolean } } }
    expect(payload.route.controls.featureEnabled).toBe(true)
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

  it('用通用条件判断请求模型是否在可用逻辑模型里', () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{
          fieldPath: 'route.requestedModel',
          valueType: 'string',
          operator: 'in',
          valueSource: 'field',
          valueFieldPath: 'logicalModels[*].id',
        }])],
      },
      modelSelect: {
        modelIds: ['model-hit'],
      },
    })

    const logicalModels = [
      { id: 'model-hit', name: 'Model Hit', enabled: true },
      { id: 'model-fallback', name: 'Model Fallback', enabled: true },
    ]

    const hit = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: { tenant: 'any', model: 'model-hit' },
      },
      logicalModels,
      metadata: {},
    })

    expect(hit.stopReason).toBe('output')
    expect(hit.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-hit'] }])
    expect(hit.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)

    const miss = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: { tenant: 'any', model: 'gpt-4o-mini' },
      },
      logicalModels,
      metadata: {},
    })

    expect(miss.trace.some(item => item.nodeId === 'condition-gate' && !item.success)).toBe(true)

    const payload = hit.outputPayload as { route: { requestedModel: string } }
    expect(payload.route.requestedModel).toBe('model-hit')
    // 不再派生「可用逻辑模型 id」这类冗余字段：上下文里的 logicalModels 才是唯一事实来源。
    expect('availableModelIds' in payload.route).toBe(false)
    // 命中判断由条件节点完成，引擎不再预先算好布尔字段。
    expect(Object.keys(payload.route).filter(key => key.startsWith('requestedModel'))).toEqual(['requestedModel'])
  })

  it('字段右值：比较字段取不到值时按空集合判定', () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{
          fieldPath: 'route.requestedModel',
          valueType: 'string',
          operator: 'in',
          valueSource: 'field',
          valueFieldPath: 'route.neverSet',
        }])],
      },
    })

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: { tenant: 'any', model: 'gpt-4o-mini' },
      },
      metadata: {},
    })

    expect(result.trace.some(item => item.nodeId === 'condition-gate' && !item.success)).toBe(true)
    expect(result.nodeOutputs).not.toHaveProperty('model-select')
  })

  it('字段右值：notIn 在比较字段取不到值时判定为真', () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([{
          fieldPath: 'route.requestedModel',
          valueType: 'string',
          operator: 'notIn',
          valueSource: 'field',
          valueFieldPath: 'route.neverSet',
        }])],
      },
      modelSelect: {
        modelIds: ['model-x'],
      },
    })

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': ['openai'] },
        body: { tenant: 'any', model: 'gpt-4o-mini' },
      },
      metadata: {},
    })

    expect(result.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-x'] }])
  })

  it('exposes protocol discovery results for downstream conditions', () => {
    const graph = createBaseGraph({
      condition: {
        cases: [singleCase([
          {
            fieldPath: 'route.protocol',
            valueType: 'string',
            operator: 'equals',
            value: 'openai-completions',
          },
          {
            fieldPath: 'request.body.messages',
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
    expect(result.nodeOutputs).not.toHaveProperty('model-select')
  })

  it('按节点 id 聚合节点输出，同名节点各占一组', () => {
    const graph = createBaseGraph()

    const result = runWorkflow(graph, {
      request: {
        path: '/v1/chat/completions',
        headers: { 'x-provider': 'openai' },
        body: { tenant: 'vip-cn', model: 'model-vip' },
      },
      logicalModels: [{ id: 'model-vip', name: 'VIP', enabled: true }],
      metadata: {},
    })

    // 输出数据挂在节点 id 上，每个节点可以有多条；渲染侧再查名称作分组标题。
    expect(new Set(Object.keys(result.nodeOutputs))).toEqual(new Set(['input', 'control-input', 'protocol', 'condition-gate', 'model-select', 'output']))
    expect(result.nodeOutputs.input).toEqual([
      { name: '请求模型', value: 'model-vip' },
      { name: '逻辑模型', value: ['model-vip'] },
    ])
    expect(result.nodeOutputs['control-input']).toEqual([{ name: '功能开关', value: true, note: 'featureEnabled' }])
    expect(result.nodeOutputs.protocol).toEqual([
      { name: '协议', value: 'openai-completions' },
      { name: '传输方式', value: 'http' },
    ])
    expect(result.nodeOutputs['condition-gate']).toEqual([{ name: '分支 1', value: '命中' }])
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
    expect(result.nodeOutputs.output).toEqual([{ name: '最终落点', value: ['model-vip', 'model-default'] }])
  })

  it('保留条件命中后的逻辑模型选择结果', () => {
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
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
  })

  it('保留逻辑模型选择节点的稳定结果', () => {
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

    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
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
    expect(result.nodeOutputs).toEqual({})
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
    expect(result.nodeOutputs).not.toHaveProperty('model-select')
    expect(result.trace.some(item => item.nodeId === 'protocol' && item.message === '节点禁用，跳过')).toBe(true)
  })

  it('不生成旧的扁平路由字段', () => {
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
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
    expect(result).not.toHaveProperty('routeDecision')
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

    graph.edges.push(edge('condition-gate', 'case-2', 'model-select'))

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

    expect(pass.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-vip', 'model-default'] }])
    expect(fail.nodeOutputs).not.toHaveProperty('model-select')
    expect(fail.trace.some(item => item.nodeId === 'condition-gate' && !item.success)).toBe(true)
  })

  it('迭代节点遍历数组并在完成后从 out 端口退出', () => {
    const nodes: WorkflowNodeModel[] = [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
      { id: 'model-select', kind: 'model-select', name: '逻辑模型选择', enabled: true, description: '', position: { x: 100, y: 0 }, source: 'fixed', variablePath: '', modelIds: ['model-a', 'model-b'], fallbackModelIds: [] },
      { id: 'control', kind: 'control-input', name: '下游', enabled: true, description: '', position: { x: 200, y: 0 }, controls: [] },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 300, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ]
    const result = runWorkflow({ version: 1, nodes, edges: [edge('input', 'out', 'model-select'), edge('model-select', 'out', 'control'), edge('control', 'out', 'output')] }, { request: { body: { items: ['a', 'b', 'c'] } }, metadata: {} })
    expect(result.stopReason).toBe('output')
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-a', 'model-b'] }])
    expect((result.outputPayload as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty('iteration')
  })

  it('逻辑模型选择节点去重并保持选择顺序', () => {
    const nodes: WorkflowNodeModel[] = [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
      { id: 'model-select', kind: 'model-select', name: '逻辑模型选择', enabled: true, description: '', position: { x: 100, y: 0 }, source: 'fixed', variablePath: '', modelIds: ['model-a', 'model-a', 'model-b'], fallbackModelIds: [] },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 300, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ]
    const result = runWorkflow({ version: 1, nodes, edges: [edge('input', 'out', 'model-select'), edge('model-select', 'out', 'output')] }, { request: { body: {} }, metadata: {} })
    expect(result.nodeOutputs['model-select']).toEqual([{ name: '落点逻辑模型', value: ['model-a', 'model-b'] }])
    expect((result.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-a', 'model-b'])
  })

  it('默认策略（基础节点组合）：请求模型是逻辑模型时直连该逻辑模型', () => {
    const result = runWorkflow(createDefaultPolicyGraph(), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'model-hit' } },
      logicalModels: [
        { id: 'model-hit', name: 'Model Hit', enabled: true },
        { id: 'default', name: 'Default', enabled: true },
      ],
      metadata: {},
    })

    const payload = result.outputPayload as { route: { modelIds: string[]; fallback: boolean } }
    expect(result.nodeOutputs['model-direct']).toEqual([
      { name: '取值字段', value: 'route.requestedModel' },
      { name: '落点逻辑模型', value: ['model-hit'] },
    ])
    expect(payload.route.modelIds).toEqual(['model-hit'])
    expect(payload.route.fallback).toBe(false)
    expect(result.trace.some(item => item.nodeId === 'condition' && item.success)).toBe(true)
  })

  it('默认策略（基础节点组合）：请求模型不是逻辑模型时落到默认逻辑模型', () => {
    const result = runWorkflow(createDefaultPolicyGraph(), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'gpt-4o-mini' } },
      logicalModels: [{ id: 'model-hit', name: 'Model Hit', enabled: true }],
      metadata: {},
    })

    const payload = result.outputPayload as { route: { modelIds: string[] } }
    expect(result.nodeOutputs['model-default']).toEqual([{ name: '落点逻辑模型', value: ['default'] }])
    expect(payload.route.modelIds).toEqual(['default'])
    expect(result.nodeOutputs).not.toHaveProperty('model-direct')
    expect(result.trace.some(item => item.nodeId === 'condition' && !item.success)).toBe(true)
  })

  it('变量取值：字段为空时回落到兜底逻辑模型', () => {
    const result = runWorkflow(createVariableModelGraph('model-fallback'), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: '' } },
      logicalModels: [{ id: 'model-hit', name: 'Model Hit', enabled: true }],
      metadata: {},
    })

    const payload = result.outputPayload as { route: { modelIds: string[]; fallback: boolean } }
    expect(result.nodeOutputs['model-select']).toEqual([
      { name: '取值字段', value: 'route.requestedModel' },
      { name: '落点逻辑模型', value: ['model-fallback'], note: '兜底' },
    ])
    expect(payload.route.modelIds).toEqual(['model-fallback'])
    expect(payload.route.fallback).toBe(true)
  })

  it('变量取值：字段是通配投影数组时整体作为落点', () => {
    const graph = createVariableModelGraph()
    graph.nodes = graph.nodes.map(node => node.kind === 'model-select'
      ? { ...node, variablePath: 'logicalModels[*].id' }
      : node)

    const result = runWorkflow(graph, {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: 'gpt-4o-mini' } },
      logicalModels: [
        { id: 'model-a', name: 'Model A', enabled: true },
        { id: 'model-b', name: 'Model B', enabled: true },
      ],
      metadata: {},
    })

    expect(result.nodeOutputs['model-select']).toEqual([
      { name: '取值字段', value: 'logicalModels[*].id' },
      { name: '落点逻辑模型', value: ['model-a', 'model-b'] },
    ])
  })

  it('变量取值：没有兜底逻辑模型且取不到值时落点为空', () => {
    const result = runWorkflow(createVariableModelGraph(), {
      request: { path: '/v1/chat/completions', headers: { 'x-provider': 'openai' }, body: { model: '' } },
      logicalModels: [{ id: 'model-hit', name: 'Model Hit', enabled: true }],
      metadata: {},
    })

    expect(result.nodeOutputs['model-select']).toEqual([
      { name: '取值字段', value: 'route.requestedModel' },
      { name: '落点逻辑模型', value: [] },
    ])
    expect((result.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual([])
    expect(result.trace.some(item => item.nodeId === 'output' && !item.success)).toBe(true)
  })
})

/* ------------------------------------------------------------------------- *
 * 类型感知的条件判定（对象 / 数组 / 未知类型）
 * ------------------------------------------------------------------------- */

/** 用一个条件规则跑一遍完整图，只关心条件节点是否命中。 */
function runConditionProbe(rule: ConditionRule, body: Record<string, unknown>) {
  const graph = createBaseGraph({ condition: { cases: [singleCase([rule])] } })
  return runWorkflow(graph, {
    request: {
      path: '/v1/chat/completions',
      headers: { 'x-provider': 'openai' },
      body: { tenant: 'vip-cn', model: 'gpt-4o-mini', ...body },
    },
    metadata: {},
  })
}

function conditionHit(rule: ConditionRule, body: Record<string, unknown>): boolean {
  const result = runConditionProbe(rule, body)
  return Boolean(result.trace.find(item => item.nodeId === 'condition-gate')?.success)
}

describe('router engine · 类型感知条件', () => {
  const rule = (patch: Partial<ConditionRule>): ConditionRule => ({
    fieldPath: 'request.body.tags',
    valueType: 'object',
    operator: 'notEmpty',
    valueSource: 'literal',
    valueFieldPath: '',
    ...patch,
  })

  it('对象按键名判定包含，空对象按无键判定为空', () => {
    expect(conditionHit(rule({ operator: 'contains', value: 'tier' }), { tags: { tier: 'gold' } })).toBe(true)
    expect(conditionHit(rule({ operator: 'contains', value: 'tier' }), { tags: { region: 'cn' } })).toBe(false)
    expect(conditionHit(rule({ operator: 'empty' }), { tags: {} })).toBe(true)
    expect(conditionHit(rule({ operator: 'empty' }), { tags: { region: 'cn' } })).toBe(false)
    expect(conditionHit(rule({ operator: 'notEmpty' }), { tags: { region: 'cn' } })).toBe(true)
    // undefined 与空对象都算空，字符串化后为 "[object Object]" 的旧行为不再出现。
    expect(conditionHit(rule({ operator: 'empty' }), {})).toBe(true)
  })

  it('数组按长度判空、按元素判包含', () => {
    const arrayRule = rule({ fieldPath: 'request.body.list', valueType: 'array' })
    expect(conditionHit(arrayRule, { list: [] })).toBe(false)
    expect(conditionHit({ ...arrayRule, operator: 'empty' }, { list: [] })).toBe(true)
    expect(conditionHit({ ...arrayRule, operator: 'notEmpty' }, { list: ['vip'] })).toBe(true)
    expect(conditionHit({ ...arrayRule, operator: 'contains', value: 'vip' }, { list: ['vip', 'cn'] })).toBe(true)
    expect(conditionHit({ ...arrayRule, operator: 'contains', value: 'v' }, { list: ['vip'] })).toBe(false)
    expect(conditionHit({ ...arrayRule, operator: 'notContains', value: 'v' }, { list: ['vip'] })).toBe(true)
  })

  it('对象按结构化序列化比较相等', () => {
    const equalRule = rule({ operator: 'equals', value: '{"tier":"gold"}' })
    expect(conditionHit(equalRule, { tags: { tier: 'gold' } })).toBe(true)
    expect(conditionHit(equalRule, { tags: { tier: 'silver' } })).toBe(false)
    expect(conditionHit({ ...equalRule, operator: 'notEquals' }, { tags: { tier: 'silver' } })).toBe(true)
  })

  it('未知类型不限制操作符，运行时按实际取值决定语义', () => {
    // valueType 是 unknown（例如数组元素、动态脚本产出），仍然可以用数值比较。
    expect(conditionHit(rule({ fieldPath: 'request.body.priority', valueType: 'unknown', operator: 'gt', value: '3' }), { priority: 5 })).toBe(true)
    expect(conditionHit(rule({ fieldPath: 'request.body.priority', valueType: 'unknown', operator: 'gt', value: '3' }), { priority: 1 })).toBe(false)
    expect(conditionHit(rule({ fieldPath: 'request.body.tags', valueType: 'unknown', operator: 'contains', value: 'tier' }), { tags: { tier: 'gold' } })).toBe(true)
  })
})

/* ------------------------------------------------------------------------- *
 * 遍历迭代
 * ------------------------------------------------------------------------- */

type IterationOverrides = {
  iteration?: Partial<Extract<WorkflowNodeModel, { kind: 'iteration' }>>
  /** 循环体直接从迭代节点连回自身（不经过任何节点），用于验证「空循环体」的最小闭合。 */
  withBody?: false
}

/**
 * 遍历迭代图：输入 → 遍历迭代 →（body）条件筛选 → 取值 → 回到迭代；迭代 → 输出。
 * 循环体是「手动回边」那一套：从 body 端口出去，末端连回迭代节点即本轮结束。
 */
function createIterationGraph(overrides?: IterationOverrides): WorkflowGraph {
  const nodes: WorkflowNodeModel[] = [
    { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
    {
      id: 'iteration',
      kind: 'iteration',
      name: '遍历迭代',
      enabled: true,
      description: '',
      position: { x: 200, y: 0 },
      sourcePath: 'logicalModels',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: 'route.modelIds',
      maxIterations: 10,
      ...overrides?.iteration,
    },
    {
      id: 'body-condition',
      kind: 'condition',
      name: '本轮是否启用',
      enabled: true,
      description: '',
      position: { x: 400, y: 0 },
      cases: [singleCase([{
        fieldPath: 'route.iteration.item.enabled',
        valueType: 'boolean',
        operator: 'isTrue',
        valueSource: 'literal',
        valueFieldPath: '',
        value: '',
      }])],
    },
    {
      id: 'body-model',
      kind: 'model-select',
      name: '取本轮模型 id',
      enabled: true,
      description: '',
      position: { x: 600, y: 0 },
      source: 'variable',
      variablePath: 'route.iteration.item.id',
      modelIds: [],
      fallbackModelIds: [],
    },
    { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 800, y: 0 }, includeTrace: true, summaryLevel: 'detailed' },
  ]

  const edges = [
    edge('input', 'out', 'iteration'),
    edge('iteration', 'out', 'output'),
  ]
  if (overrides?.withBody !== false) {
    edges.push(
      edge('iteration', 'body', 'body-condition'),
      edge('body-condition', 'case-1', 'body-model'),
      // 循环体末端连回迭代节点：这一条边代表「本轮结束」。
      edge('body-model', 'out', 'iteration'),
      edge('body-condition', 'else', 'iteration'),
    )
  }

  return { version: 1, nodes, edges }
}

const logicalModels = [
  { id: 'model-off', name: 'Off', enabled: false },
  { id: 'model-on', name: 'On', enabled: true },
  { id: 'model-later', name: 'Later', enabled: true },
]

describe('router engine · 遍历迭代', () => {
  it('数组来源：逐项跑循环体，首次命中即停止并写回结果', () => {
    const result = runWorkflow(createIterationGraph(), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      logicalModels,
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    const iterationTrace = result.trace.find(item => item.nodeId === 'iteration')
    expect(iterationTrace?.success).toBe(true)
    expect(iterationTrace?.details).toMatchObject({
      sourcePath: 'logicalModels',
      collectMode: 'first',
      itemCount: 3,
      executed: 2,
      hitCount: 1,
      hitKeys: ['1'],
    })

    expect(result.nodeOutputs.iteration).toEqual([
      { name: '第 1 轮（0）', value: '未命中', note: 'route.modelIds' },
      { name: '第 2 轮（1）', value: ['model-on'] },
      { name: '遍历轮数', value: 2 },
      { name: '汇总结果', value: ['model-on'] },
    ])

    // 汇总结果写回 collectPath / resultPath，下游照常可以读 route.modelIds。
    expect((result.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual(['model-on'])
  })

  it('对象来源按「键值对」遍历，route.iteration.key 是键名', () => {
    const result = runWorkflow(createIterationGraph({
      iteration: { sourcePath: 'metadata.tags', collectPath: 'route.iteration.item', collectMode: 'last', resultPath: 'route.iterationResult' },
    }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      metadata: { tags: { gold: 'a', vip: 'b' } },
    })

    const iterationTrace = result.trace.find(item => item.nodeId === 'iteration')
    expect(iterationTrace?.details).toMatchObject({ itemCount: 2, executed: 2, hitKeys: ['gold', 'vip'] })

    // `last` 模式保留最后一个命中值；收集路径读取的是本轮作用域，所以每轮都命中。
    const payload = result.outputPayload as { route: { iterationResult: unknown; iteration: { key: string } } }
    expect(payload.route.iterationResult).toBe('b')
    expect(payload.route.iteration.key).toBe('vip')
  })

  it('count 模式只累计轮数，不受收集路径是否命中影响', () => {
    const result = runWorkflow(createIterationGraph({
      iteration: { sourcePath: 'metadata.tags', collectPath: 'route.modelIds', collectMode: 'count', resultPath: 'route.iterationCount' },
    }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      metadata: { tags: { a: 1, b: 2, c: 3 } },
    })

    const payload = result.outputPayload as { route: { iterationCount: number } }
    expect(payload.route.iterationCount).toBe(3)
    expect(result.trace.find(item => item.nodeId === 'iteration')?.details).toMatchObject({ executed: 3, hitCount: 0 })
  })

  it('list 模式收集每轮命中值', () => {
    // 让循环体每轮都命中：收集路径改读本轮作用域里的 enabled。
    const result = runWorkflow(createIterationGraph({
      iteration: { sourcePath: 'logicalModels[*].id', collectPath: 'route.iteration.item', collectMode: 'list', resultPath: 'route.hitIds' },
    }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      logicalModels,
      metadata: {},
    })

    // 通配投影把对象数组拍平成 id 数组，遍历的是字符串元素。
    const payload = result.outputPayload as { route: { hitIds: string[] } }
    expect(payload.route.hitIds).toEqual(['model-off', 'model-on', 'model-later'])
    expect(result.trace.find(item => item.nodeId === 'iteration')?.details).toMatchObject({ sourcePath: 'logicalModels[*].id', executed: 3 })
  })

  it('轮数上限生效，未遍历完的项会记录在 trace 里', () => {
    const result = runWorkflow(createIterationGraph({
      iteration: { maxIterations: 1, collectMode: 'list' },
    }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      logicalModels,
      metadata: {},
    })

    const iterationTrace = result.trace.find(item => item.nodeId === 'iteration')
    expect(iterationTrace?.details).toMatchObject({ executed: 1, itemCount: 3 })
    expect(String(iterationTrace?.details?.stoppedReason)).toContain('迭代上限')
  })

  it('没有连接循环体时不执行任何一轮，但仍把空结果写回', () => {
    const result = runWorkflow(createIterationGraph({ withBody: false }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      logicalModels,
      metadata: {},
    })

    const iterationTrace = result.trace.find(item => item.nodeId === 'iteration')
    expect(iterationTrace?.success).toBe(false)
    expect(iterationTrace?.details).toMatchObject({ bodyConnected: false, executed: 0 })
    expect((result.outputPayload as { route: { modelIds: string[] } }).route.modelIds).toEqual([])
    // 遍历不成立也要继续往下走，落到出口节点。
    expect(result.stopReason).toBe('output')
  })

  it('遍历来源为空时执行 0 轮，不进入循环体', () => {
    const result = runWorkflow(createIterationGraph({
      iteration: { sourcePath: 'metadata.missing', collectMode: 'count', resultPath: 'route.iterationCount' },
    }), {
      request: { path: '/v1/chat/completions', headers: {}, body: { model: 'gpt-4o-mini' } },
      metadata: {},
    })

    expect(result.trace.find(item => item.nodeId === 'iteration')?.details).toMatchObject({ itemCount: 0, executed: 0 })
    expect((result.outputPayload as { route: { iterationCount: number } }).route.iterationCount).toBe(0)
    expect(result.nodeOutputs['body-condition']).toBeUndefined()
  })
})


/** 最小变量取值图：输入 → 逻辑模型选择（读取 route.requestedModel）→ 输出。 */
function createVariableModelGraph(fallbackModelId?: string): WorkflowGraph {
  return {
    version: 1,
    nodes: [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 } },
      {
        id: 'model-select',
        kind: 'model-select',
        name: '逻辑模型选择',
        enabled: true,
        description: '',
        position: { x: 100, y: 0 },
        source: 'variable',
        variablePath: 'route.requestedModel',
        modelIds: [],
        fallbackModelIds: fallbackModelId ? [fallbackModelId] : [],
      },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 200, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ],
    edges: [edge('input', 'out', 'model-select'), edge('model-select', 'out', 'output')],
  }
}
