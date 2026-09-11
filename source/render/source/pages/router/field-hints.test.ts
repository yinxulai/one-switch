import { describe, expect, it } from 'vitest'
import { resolveInputHints } from './field-hints'
import type { WorkflowGraph, WorkflowNodeModel } from './types'

const position = { x: 0, y: 0 }
const samplePayload = { request: { body: { model: 'gpt-4o-mini', priority: 2 } }, metadata: { source: 'test' } }
const edge = (sourceNodeId: string, sourcePort: string, targetNodeId: string) => ({ id: `${sourceNodeId}:${sourcePort}->${targetNodeId}`, sourceNodeId, sourcePort, targetNodeId })
const graph = (nodes: WorkflowNodeModel[], edges: WorkflowGraph['edges']): WorkflowGraph => ({ version: 1, nodes, edges })
const input = (id = 'input'): WorkflowNodeModel => ({ id, kind: 'input', name: id, enabled: true, description: '', position })
const output = (): WorkflowNodeModel => ({ id: 'output', kind: 'output', name: '输出', enabled: true, description: '', position, includeTrace: true, summaryLevel: 'brief' })
const condition = (id: string): WorkflowNodeModel => ({ id, kind: 'condition', name: id, enabled: true, description: '', position, cases: [{ id: 'case-1', name: '分支 1', logicalOperator: 'and', conditions: [{ fieldPath: 'request.body.model', valueType: 'string', operator: 'equals' }] }] })
const protocol = (id: string): WorkflowNodeModel => ({ id, kind: 'protocol-discovery', name: id, enabled: true, description: '', position })
const control = (id: string): WorkflowNodeModel => ({ id, kind: 'control-input', name: id, enabled: true, description: '', position, controls: [{ id: `${id}-mode`, key: 'mode', label: '模式', kind: 'select', enabled: true, defaultValue: 'fast', options: [{ label: 'Fast', value: 'fast' }, { label: 'Safe', value: 'safe' }] }] })

describe('resolveInputHints', () => {
  it('仅提供真实上游字段并沿多级连接传递', () => {
    const target = condition('target')
    const hints = resolveInputHints(graph([input(), control('control'), protocol('protocol'), target, output()], [edge('input', 'out', 'control'), edge('control', 'out', 'protocol'), edge('protocol', 'openai-completions', 'target')]), target.id, samplePayload)
    expect(hints.fields.map(field => field.path)).toEqual(expect.arrayContaining(['request.body.model', 'route.controls.mode', 'route.protocol']))
    expect(hints.fields.find(field => field.path === 'route.controls.mode')).toMatchObject({ valueType: 'enum', enumOptions: ['fast', 'safe'] })
  })
  it('按协议分支收窄枚举并忽略孤立节点', () => {
    const target = condition('target')
    const hints = resolveInputHints(graph([input(), protocol('protocol'), target, control('isolated'), output()], [edge('input', 'out', 'protocol'), edge('protocol', 'unknown', 'target')]), target.id, samplePayload)
    expect(hints.fields.find(field => field.path === 'route.protocol')?.enumOptions).toEqual(['unknown'])
    expect(hints.fields.find(field => field.path === 'route.transport')?.enumOptions).toEqual(['http', 'http-sse'])
    expect(hints.fields.map(field => field.path)).not.toContain('route.controls.mode')
  })
  it('循环图不会无限遍历且禁用节点不产生字段', () => {
    const target = condition('target')
    const disabled = control('control'); disabled.enabled = false
    const hints = resolveInputHints(graph([input(), disabled, target, output()], [edge('input', 'out', 'control'), edge('control', 'out', 'target'), edge('target', 'else', 'control')]), target.id, samplePayload)
    expect(hints.upstreamNodeIds).toEqual(expect.arrayContaining(['input', 'control']))
    expect(hints.upstreamNodeIds).not.toContain('target')
    expect(hints.fields.map(field => field.path)).not.toContain('route.controls.mode')
  })
  it('声明队列选择节点的落点队列字段', () => {
    const target = condition('target')
    const queueSelect: WorkflowNodeModel = { id: 'queue-select', kind: 'queue-select', name: '队列选择', enabled: true, description: '', position, source: 'fixed', variablePath: '', queueIds: ['model-a', 'model-b'], fallbackQueueIds: [] }
    const hints = resolveInputHints(graph([input(), queueSelect, target, output()], [edge('input', 'out', 'queue-select'), edge('queue-select', 'out', 'target')]), target.id, samplePayload)
    expect(hints.fields.map(field => field.path)).toContain('route.queueIds')
    expect(hints.fields.map(field => field.path)).toContain('route.fallback')
    expect(hints.fields.map(field => field.path)).not.toContain('metadata.iteration.current')
    expect(hints.fields.map(field => field.path)).not.toContain('metadata.loop.index')
  })

  it('提供路由决策依据字段用于通用条件判断', () => {
    const target = condition('target')
    const hints = resolveInputHints(
      graph([input(), protocol('protocol'), target, output()], [edge('input', 'out', 'protocol'), edge('protocol', 'openai-completions', 'target')]),
      target.id,
      {
        request: { body: { model: 'gpt-4o-mini', priority: 2 }, headers: { 'x-provider': ['openai'] } },
        queues: [{ id: 'default', name: 'Default', enabled: true }],
        metadata: { source: 'test' },
      },
    )

    const paths = hints.fields.map(field => field.path)
    expect(paths).toEqual(expect.arrayContaining([
      'queues',
      'route.traceId',
      'route.requestedModel',
      'route.requestedModelInQueues',
      'route.availableQueueIds',
      'route.protocol',
      'route.transport',
    ]))
    // 协议归一化的中间结果只进 trace，不再污染 payload。
    expect(paths).not.toContain('route.protocolOutput')
    expect(paths).not.toContain('metadata.protocolOutput')
  })
})
