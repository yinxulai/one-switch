import { describe, expect, it } from 'vitest'
import { runWorkflow as runWorkflowEngine } from './engine'
import type { ConditionCase, ConditionRule, RuntimeLogicalModel, WorkflowNodeModel } from './types'

const runtimeLogicalModels: RuntimeLogicalModel[] = [
  { id: 'model-vip', name: 'gpt-4o-mini', enabled: true },
  { id: 'model-default', name: 'default', enabled: true },
]

function runWorkflow(nodes: WorkflowNodeModel[], inputPayload: unknown, logicalModels = runtimeLogicalModels) {
  return runWorkflowEngine(nodes, inputPayload, { logicalModels })
}

function singleCase(next = 'resolver', conditions: ConditionRule[] = [{ fieldPath: 'request.body.tenant', valueType: 'string', operator: 'startsWith', value: 'vip-' }]): ConditionCase {
  return {
    id: 'case-1',
    name: '分支 1',
    logicalOperator: 'and',
    conditions,
    next,
  }
}

type BaseNodeOverrides = {
  input?: Partial<Extract<WorkflowNodeModel, { kind: 'input' }>>
  control?: Partial<Extract<WorkflowNodeModel, { kind: 'control-input' }>>
  protocol?: Partial<Extract<WorkflowNodeModel, { kind: 'protocol-discovery' }>>
  condition?: Partial<Extract<WorkflowNodeModel, { kind: 'condition' }>>
  resolver?: Partial<Extract<WorkflowNodeModel, { kind: 'resolver' }>>
}

function createBaseNodes(overrides?: BaseNodeOverrides): WorkflowNodeModel[] {
  const conditionNode: Extract<WorkflowNodeModel, { kind: 'condition' }> = {
    id: 'condition-gate',
    kind: 'condition',
    name: '租户准入判断',
    enabled: true,
    description: '仅放行 vip 租户',
    position: { x: 480, y: 120 },
    cases: [singleCase()],
    elseNext: 'output',
    ...overrides?.condition,
  }

  const controlNode: Extract<WorkflowNodeModel, { kind: 'control-input' }> = {
    id: 'control-input',
    kind: 'control-input',
    name: '控制输入',
    enabled: true,
    description: '注入系统控制值',
    position: { x: 250, y: 120 },
    controls: [
      {
        id: 'feature-toggle',
        key: 'featureEnabled',
        label: '功能开关',
        kind: 'switch',
        enabled: true,
        defaultValue: true,
      },
      {
        id: 'route-mode',
        key: 'routeMode',
        label: '路由模式',
        kind: 'select',
        enabled: true,
        defaultValue: 'balanced',
        options: [
          { label: 'Balanced', value: 'balanced' },
          { label: 'Fast', value: 'fast' },
        ],
      },
    ],
    next: 'protocol',
    ...overrides?.control,
  }

  const resolverNode: Extract<WorkflowNodeModel, { kind: 'resolver' }> = {
    id: 'resolver',
    kind: 'resolver',
    name: '模型解析',
    enabled: true,
    description: '根据请求 model 匹配逻辑模型',
    position: { x: 780, y: 120 },
    input: { path: 'request.body.model' },
    resolution: {
      resource: 'logical-model',
      candidates: { source: 'catalog' },
      match: [{ field: 'id', operator: 'equalsInput' }, { field: 'name', operator: 'equalsInput' }],
      fallback: { type: 'reference', resource: 'logical-model', id: 'model-default' },
    },
    next: 'output',
    ...overrides?.resolver,
  }

  return [
    {
      id: 'input',
      kind: 'input',
      name: '输入',
      enabled: true,
      description: '输入标准化',
      position: { x: 60, y: 120 },
      next: 'control-input',
      ...overrides?.input,
    },
    controlNode,
    {
      id: 'protocol',
      kind: 'protocol-discovery',
      name: '协议发现',
      enabled: true,
      description: '识别请求协议并分发分支',
      position: { x: 250, y: 120 },
      branches: {
        'openai-completions': 'condition-gate',
        'openai-responses': 'condition-gate',
        'anthropic-messages': 'condition-gate',
        unknown: 'output',
      },
      ...overrides?.protocol,
    },
    conditionNode,
    resolverNode,
    {
      id: 'output',
      kind: 'output',
      name: '输出',
      enabled: true,
      description: '路由结果输出',
      position: { x: 1050, y: 120 },
      includeTrace: true,
      summaryLevel: 'detailed',
    },
  ]
}

describe('router engine', () => {
  it('routes openai-completions requests through IF and resolver nodes', () => {
    const nodes = createBaseNodes()

    const result = runWorkflow(nodes, {
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
    expect(result.resolutions.resolver?.selectedId).toBe('model-vip')
    expect(result.trace.some(item => item.nodeId === 'condition-gate' && item.success)).toBe(true)
  })

  it('injects control-input values into metadata for downstream conditions', () => {
    const nodes = createBaseNodes({
      condition: {
        cases: [singleCase('resolver', [{
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

    const result = runWorkflow(nodes, {
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
    const nodes = createBaseNodes()

    const result = runWorkflow(nodes, {
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

  it('sends unknown protocol directly to output branch', () => {
    const nodes = createBaseNodes()

    const result = runWorkflow(nodes, {
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
    expect(result.resolutions).toEqual({})
  })

  it('falls back to the enabled default logical model when request model is unknown', () => {
    const nodes = createBaseNodes()

    const result = runWorkflow(nodes, {
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
    expect(result.resolutions.resolver?.selectedId).toBe('model-default')
    expect(result.resolutions.resolver?.source).toBe('fallback')
  })

  it('matches a request model by logical model id', () => {
    const result = runWorkflow(createBaseNodes(), {
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

    expect(result.resolutions.resolver?.selectedId).toBe('model-vip')
    expect(result.resolutions.resolver?.source).toBe('match')
  })

  it('returns an error when the input node is missing', () => {
    const nodes = createBaseNodes()
      .filter(node => node.kind !== 'input')

    const result = runWorkflow(nodes, {
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
    expect(result.resolutions).toEqual({})
    expect(result.trace).toHaveLength(1)
    expect(result.trace[0]?.message).toBe('缺少输入节点')
  })

  it('skips a disabled protocol-discovery node and follows the unknown branch', () => {
    const nodes = createBaseNodes({
      protocol: {
        enabled: false,
        branches: {
          'openai-completions': 'condition-gate',
          'openai-responses': 'condition-gate',
          'anthropic-messages': 'condition-gate',
          unknown: 'output',
        },
      },
    })

    const result = runWorkflow(nodes, {
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
    expect(result.resolutions).toEqual({})
    expect(result.trace.some(item => item.nodeId === 'protocol' && item.message === '节点禁用，跳过')).toBe(true)
  })

  it('records an unmatched resolver without legacy route output', () => {
    const nodes = createBaseNodes({
      protocol: {
        branches: {
          'openai-completions': 'condition-gate',
          'openai-responses': 'condition-gate',
          'anthropic-messages': 'condition-gate',
          unknown: 'condition-gate',
        },
      },
    })

    const result = runWorkflow(nodes, {
      request: {
        path: '/v2/unknown',
        headers: {},
        body: {
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    }, [])

    expect(result.stopReason).toBe('output')
    expect(result.resolutions.resolver?.selectedId).toBeNull()
    expect(result.resolutions.resolver?.source).toBe('none')
    expect(result).not.toHaveProperty('routeDecision')
    expect(result).not.toHaveProperty('targetQueue')
  })

  it('supports multiple IF branches with OR and ELSE fallback', () => {
    const nodes = createBaseNodes({
      condition: {
        cases: [
          singleCase('resolver', [{ fieldPath: 'request.body.tenant', valueType: 'string', operator: 'equals', value: 'vip-cn' }]),
          {
            id: 'case-2',
            name: '高优先级',
            logicalOperator: 'or',
            conditions: [
              { fieldPath: 'request.body.priority', valueType: 'number', operator: 'gte', value: '5' },
              { fieldPath: 'request.body.tenant', valueType: 'string', operator: 'equals', value: 'internal' },
            ],
            next: 'output',
          },
        ],
        elseNext: 'output',
      },
    })

    const result = runWorkflow(nodes, {
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
    const nodes = createBaseNodes({
      condition: {
        cases: [singleCase('resolver', [{
          fieldPath: 'request.body.priority',
          valueType: 'number',
          operator: 'between',
          value: '1',
          secondaryValue: '3',
        }])],
      },
    })

    const pass = runWorkflow(nodes, {
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

    const fail = runWorkflow(nodes, {
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

    expect(pass.resolutions.resolver?.selectedId).toBe('model-vip')
    expect(fail.resolutions).toEqual({})
    expect(fail.trace.some(item => item.nodeId === 'condition-gate' && !item.success)).toBe(true)
  })

  it('迭代节点遍历数组并在完成后从 out 端口退出', () => {
    const nodes: WorkflowNodeModel[] = [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 }, next: 'iteration' },
      { id: 'iteration', kind: 'iteration', name: '迭代', enabled: true, description: '', position: { x: 100, y: 0 }, input: { path: 'request.body.items' }, bodyNext: 'control', next: 'output' },
      { id: 'control', kind: 'control-input', name: '循环体', enabled: true, description: '', position: { x: 200, y: 0 }, controls: [], next: 'iteration' },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 300, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ]
    const result = runWorkflow(nodes, { request: { body: { items: ['a', 'b', 'c'] } }, metadata: {} })
    expect(result.stopReason).toBe('output')
    expect(result.trace.filter(item => item.nodeId === 'iteration' && item.message.startsWith('迭代 '))).toHaveLength(3)
    expect(result.trace.some(item => item.nodeId === 'iteration' && item.message === '迭代完成，共 3 项')).toBe(true)
    expect((result.outputPayload as { metadata: Record<string, unknown> }).metadata.iteration).toBeUndefined()
  })

  it('循环节点按条件执行循环体并在达到上限后退出', () => {
    const nodes: WorkflowNodeModel[] = [
      { id: 'input', kind: 'input', name: '输入', enabled: true, description: '', position: { x: 0, y: 0 }, next: 'loop' },
      { id: 'loop', kind: 'loop', name: '循环', enabled: true, description: '', position: { x: 100, y: 0 }, maxIterations: 2, condition: { fieldPath: 'request.body.continue', valueType: 'boolean', operator: 'isTrue' }, bodyNext: 'control', next: 'output' },
      { id: 'control', kind: 'control-input', name: '循环体', enabled: true, description: '', position: { x: 200, y: 0 }, controls: [], next: 'loop' },
      { id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position: { x: 300, y: 0 }, includeTrace: true, summaryLevel: 'brief' },
    ]
    const result = runWorkflow(nodes, { request: { body: { continue: true } }, metadata: {} })
    expect(result.stopReason).toBe('output')
    expect(result.trace.filter(item => item.nodeId === 'loop' && item.message.includes('条件满足'))).toHaveLength(2)
    expect(result.trace.some(item => item.message === '达到最大迭代次数 2，退出循环')).toBe(true)
  })
})
