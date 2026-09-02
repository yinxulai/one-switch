import { describe, expect, it } from 'vitest'
import { runWorkflow } from './engine'
import type { WorkflowNodeModel } from './types'

type BaseNodeOverrides = {
  input?: Partial<Extract<WorkflowNodeModel, { kind: 'input' }>>
  control?: Partial<Extract<WorkflowNodeModel, { kind: 'control-input' }>>
  protocol?: Partial<Extract<WorkflowNodeModel, { kind: 'protocol-discovery' }>>
  condition?: Partial<Extract<WorkflowNodeModel, { kind: 'condition' }>>
  selector?: Partial<Extract<WorkflowNodeModel, { kind: 'logical-model-selector' }>>
}

function createBaseNodes(overrides?: BaseNodeOverrides): WorkflowNodeModel[] {
  const conditionNode: Extract<WorkflowNodeModel, { kind: 'condition' }> = {
    id: 'condition-gate',
    kind: 'condition',
    name: '租户准入判断',
    enabled: true,
    description: '仅放行 vip 租户',
    position: { x: 480, y: 120 },
    rule: {
      fieldPath: 'request.body.tenant',
      valueType: 'string',
      operator: 'startsWith',
      value: 'vip-',
    },
    nextTrue: 'logical-model-selector',
    nextFalse: 'output',
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

  const selectorNode: Extract<WorkflowNodeModel, { kind: 'logical-model-selector' }> = {
    id: 'logical-model-selector',
    kind: 'logical-model-selector',
    name: '模型选择器',
    enabled: true,
    description: '根据分支选择逻辑模型',
    position: { x: 780, y: 120 },
    logicalModelId: 'logical-chat-vip',
    next: 'output',
    ...overrides?.selector,
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
    selectorNode,
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
  it('routes openai-completions requests to model selector and target queue', () => {
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
    expect(result.targetQueue).toBe('queue-vip-cn')
    expect(result.routeDecision?.targetQueue).toBe('queue-vip-cn')
    expect(result.trace.some(item => item.kind === 'logical-model-selector' && item.success)).toBe(true)
  })

  it('injects control-input values into metadata for downstream conditions', () => {
    const nodes = createBaseNodes({
      condition: {
        rule: {
          fieldPath: 'metadata.controls.featureEnabled',
          valueType: 'boolean',
          operator: 'isTrue',
        },
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
          tenant: 'vip-cn',
          model: 'gpt-4o-mini',
        },
      },
      metadata: {},
    })

    const payload = result.outputPayload as { metadata: { controls: { featureEnabled: boolean } } }
    expect(payload.metadata.controls.featureEnabled).toBe(true)
    expect(result.targetQueue).toBe('queue-vip-cn')
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
    expect(result.targetQueue).toBeNull()
    expect(result.routeDecision).toBeNull()
  })

  it('supports logical-model-only selector configuration', () => {
    const nodes = createBaseNodes({
      selector: {
        logicalModelId: 'logical-chat-default',
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
    expect(result.targetQueue).toBe('queue-default')
    expect(result.routeDecision?.selectedModel).toBe('logical-chat-default')
    expect(result.routeDecision?.matched).toBe(true)
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
    expect(result.targetQueue).toBeNull()
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
    expect(result.routeDecision).toBeNull()
    expect(result.trace.some(item => item.nodeId === 'protocol' && item.message === '节点禁用，跳过')).toBe(true)
  })

  it('marks unsupported logical model selection as unmatched', () => {
    const nodes = createBaseNodes({
      protocol: {
        branches: {
          'openai-completions': 'condition-gate',
          'openai-responses': 'condition-gate',
          'anthropic-messages': 'condition-gate',
          unknown: 'condition-gate',
        },
      },
      selector: {
        logicalModelId: 'logical-chat-vip',
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
    })

    expect(result.stopReason).toBe('output')
    expect(result.routeDecision?.selectedModel).toBe('logical-chat-vip')
    expect(result.routeDecision?.matched).toBe(false)
    expect(result.targetQueue).toBe('')
  })

  it('supports numeric between condition operator', () => {
    const nodes = createBaseNodes({
      condition: {
        rule: {
          fieldPath: 'request.body.priority',
          valueType: 'number',
          operator: 'between',
          value: '1',
          secondaryValue: '3',
        },
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

    expect(pass.targetQueue).toBe('queue-vip-cn')
    expect(fail.targetQueue).toBeNull()
  })
})
