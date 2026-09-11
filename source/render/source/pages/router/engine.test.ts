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
          valueFieldPath: 'route.availableModelIds',
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

    const payload = hit.outputPayload as { route: { requestedModel: string; availableModelIds: string[] } }
    expect(payload.route.requestedModel).toBe('model-hit')
    expect(payload.route.availableModelIds).toEqual(['model-hit', 'model-fallback'])
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
          valueFieldPath: 'route.availableModelIds',
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
          valueFieldPath: 'route.availableModelIds',
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
      { name: '可用逻辑模型', value: ['model-vip'] },
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

  it('变量取值：字段是字符串数组时整体作为落点', () => {
    const graph = createVariableModelGraph()
    graph.nodes = graph.nodes.map(node => node.kind === 'model-select'
      ? { ...node, variablePath: 'route.availableModelIds' }
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
      { name: '取值字段', value: 'route.availableModelIds' },
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
