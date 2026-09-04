import { describe, expect, it } from 'vitest'
import { resolveInputHints } from './field-hints'
import type { WorkflowNodeModel } from './types'

const position = { x: 0, y: 0 }
const samplePayload = {
  request: {
    body: { model: 'gpt-4o-mini', priority: 2 },
  },
  metadata: { source: 'test' },
}

function input(next: string): WorkflowNodeModel {
  return {
    id: 'input',
    kind: 'input',
    name: '输入',
    enabled: true,
    description: '',
    position,
    next,
  }
}

function condition(id: string): Extract<WorkflowNodeModel, { kind: 'condition' }> {
  return {
    id,
    kind: 'condition',
    name: id,
    enabled: true,
    description: '',
    position,
    cases: [
      {
        id: 'case-1',
        name: '分支 1',
        logicalOperator: 'and',
        conditions: [{ fieldPath: 'request.body.model', valueType: 'string', operator: 'equals' }],
        next: 'output',
      },
    ],
    elseNext: 'output',
  }
}

function output(): WorkflowNodeModel {
  return {
    id: 'output',
    kind: 'output',
    name: '输出',
    enabled: true,
    description: '',
    position,
    includeTrace: true,
    summaryLevel: 'brief',
  }
}

function protocolDiscovery(id: string, target: string, unknownTarget = 'output'): WorkflowNodeModel {
  return {
    id,
    kind: 'protocol-discovery',
    name: id,
    enabled: true,
    description: '',
    position,
    branches: {
      'openai-completions': target,
      'openai-responses': 'output',
      'anthropic-messages': 'output',
      unknown: unknownTarget,
    },
  }
}

function controlInput(id: string, next: string): WorkflowNodeModel {
  return {
    id,
    kind: 'control-input',
    name: id,
    enabled: true,
    description: '',
    position,
    next,
    controls: [
      {
        id: `${id}-mode`,
        key: 'mode',
        label: '模式',
        kind: 'select',
        enabled: true,
        defaultValue: 'fast',
        options: [
          { label: 'Fast', value: 'fast' },
          { label: 'Safe', value: 'safe' },
        ],
      },
    ],
  }
}

describe('resolveInputHints', () => {
  it('仅提供真实上游节点产生的字段', () => {
    const target = condition('condition')
    const models = [
      input('condition'),
      target,
      protocolDiscovery('isolated-protocol', 'output'),
      controlInput('isolated-control', 'output'),
      output(),
    ]

    const hints = resolveInputHints(models, target.id, samplePayload)
    expect(hints.fields.map(field => field.path)).toContain('request.body.model')
    expect(hints.fields.map(field => field.path)).not.toContain('metadata.protocol')
    expect(hints.fields.map(field => field.path)).not.toContain('metadata.controls.mode')
  })

  it('沿多级连接传递上游字段', () => {
    const target = condition('condition')
    const models = [
      input('control'),
      controlInput('control', 'protocol'),
      protocolDiscovery('protocol', 'condition'),
      target,
      output(),
    ]

    const hints = resolveInputHints(models, target.id, samplePayload)
    expect(hints.fields.map(field => field.path)).toEqual(expect.arrayContaining([
      'request.body.model',
      'metadata.controls.mode',
      'metadata.protocol',
    ]))
    expect(hints.fields.find(field => field.path === 'metadata.controls.mode')).toMatchObject({
      valueType: 'enum',
      enumOptions: ['fast', 'safe'],
    })
  })

  it('根据到达当前节点的协议分支收窄枚举值', () => {
    const target = condition('condition')
    const models = [
      input('protocol'),
      protocolDiscovery('protocol', 'output', 'condition'),
      target,
      output(),
    ]

    const field = resolveInputHints(models, target.id, samplePayload).fields
      .find(item => item.path === 'metadata.protocol')
    expect(field?.enumOptions).toEqual(['unknown'])
  })

  it('循环图不会导致无限遍历或把当前节点当作字段来源', () => {
    const target = condition('condition')
    const loopControl = controlInput('control', 'condition')
    target.cases[0].next = 'control'
    const models = [input('condition'), target, loopControl, output()]

    const hints = resolveInputHints(models, target.id, samplePayload)
    expect(hints.upstreamNodeIds).toEqual(expect.arrayContaining(['input', 'control']))
    expect(hints.upstreamNodeIds).not.toContain('condition')
    expect(hints.fields.filter(field => field.path === 'metadata.controls.mode')).toHaveLength(1)
  })

  it('禁用的上游节点不声明运行时不会产生的字段', () => {
    const target = condition('condition')
    const disabledControl = controlInput('control', 'condition')
    disabledControl.enabled = false

    const hints = resolveInputHints([
      input('control'),
      disabledControl,
      target,
      output(),
    ], target.id, samplePayload)

    expect(hints.fields.map(field => field.path)).not.toContain('metadata.controls.mode')
    expect(hints.fields.map(field => field.path)).toContain('request.body.model')
  })

  it('声明 Logic 节点的 body/out 连线和迭代字段', () => {
    const target = condition('condition')
    const iteration: Extract<WorkflowNodeModel, { kind: 'iteration' }> = {
      id: 'iteration',
      kind: 'iteration',
      name: '迭代',
      enabled: true,
      description: '',
      position,
      input: { path: 'request.body.items' },
      bodyNext: 'condition',
      next: 'output',
    }
    const hints = resolveInputHints([input('iteration'), iteration, target, output()], target.id, samplePayload)
    expect(hints.fields.map(field => field.path)).toEqual(expect.arrayContaining(['request.body.model', 'metadata.iteration.current', 'metadata.iteration.index']))
    expect(hints.upstreamNodeIds).toEqual(expect.arrayContaining(['input', 'iteration']))
  })

  it('声明 Loop 节点的 metadata.loop.index 字段', () => {
    const target = condition('condition')
    const loop: Extract<WorkflowNodeModel, { kind: 'loop' }> = {
      id: 'loop',
      kind: 'loop',
      name: '循环',
      enabled: true,
      description: '',
      position,
      maxIterations: 3,
      condition: { fieldPath: 'request.body.priority', valueType: 'number', operator: 'gte', value: '1' },
      bodyNext: 'condition',
      next: 'output',
    }
    const hints = resolveInputHints([input('loop'), loop, target, output()], target.id, samplePayload)
    expect(hints.fields.map(field => field.path)).toContain('metadata.loop.index')
    expect(hints.upstreamNodeIds).toEqual(expect.arrayContaining(['input', 'loop']))
  })
})
