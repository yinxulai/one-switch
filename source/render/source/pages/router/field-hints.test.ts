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
  it('声明逻辑模型选择节点的落点逻辑模型字段', () => {
    const target = condition('target')
    const modelSelect: WorkflowNodeModel = { id: 'model-select', kind: 'model-select', name: '逻辑模型选择', enabled: true, description: '', position, source: 'fixed', variablePath: '', modelIds: ['model-a', 'model-b'], fallbackModelIds: [] }
    const hints = resolveInputHints(graph([input(), modelSelect, target, output()], [edge('input', 'out', 'model-select'), edge('model-select', 'out', 'target')]), target.id, samplePayload)
    expect(hints.fields.map(field => field.path)).toContain('route.modelIds')
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
        logicalModels: [{ id: 'default', name: 'Default', enabled: true }],
        metadata: { source: 'test' },
      },
    )

    const paths = hints.fields.map(field => field.path)
    expect(paths).toEqual(expect.arrayContaining([
      'logicalModels',
      'logicalModels[*].id',
      'route.requestedModel',
      'route.protocol',
      'route.transport',
    ]))
    // 「可用逻辑模型 id」不再派生：列表字段给出通配投影路径供条件直接比较。
    expect(paths).not.toContain('route.availableModelIds')
    // 命中判断交给通用条件节点，引擎不再产出预计算布尔字段。
    expect(paths.filter(path => path.startsWith('route.requestedModel'))).toEqual(['route.requestedModel'])
    // 请求头整体作为一个不透明字段暴露，不再展开成用不了的点路径。
    expect(paths).toContain('request.headers')
    expect(paths).not.toContain('request.headers.x-provider')
    // 协议归一化的中间结果只进 trace，不再污染 payload。
    expect(paths).not.toContain('route.protocolOutput')
    expect(paths).not.toContain('metadata.protocolOutput')
  })

  it('对象字段同时暴露整体与细化字段，便于整块判断', () => {
    const target = condition('target')
    const hints = resolveInputHints(
      graph([input(), target, output()], [edge('input', 'out', 'target')]),
      target.id,
      { request: { body: { model: 'x', options: { tier: 'gold', retries: 2 } } } },
    )
    const field = (path: string) => hints.fields.find(item => item.path === path)

    // 整体对象：可以用 empty / notEmpty / contains（按键名）来判断。
    expect(field('request.body.options')).toMatchObject({ valueType: 'object', sourceNodeId: 'input' })
    expect(field('request.body.options')?.note).toBeTruthy()
    // 细化字段照旧可用。
    expect(field('request.body.options.tier')).toMatchObject({ valueType: 'string' })
    expect(field('request.body.options.retries')).toMatchObject({ valueType: 'number' })
  })

  it('对象数组给出通配投影字段，普通数组只给整体字段', () => {
    const target = condition('target')
    const hints = resolveInputHints(
      graph([input(), target, output()], [edge('input', 'out', 'target')]),
      target.id,
      {
        logicalModels: [{ id: 'a', enabled: true }, { id: 'b', enabled: false }],
        request: { body: { tags: ['vip', 'cn'] } },
      },
    )
    const paths = hints.fields.map(item => item.path)

    expect(hints.fields.find(item => item.path === 'logicalModels')).toMatchObject({ valueType: 'array' })
    expect(hints.fields.find(item => item.path === 'logicalModels')?.note).toBeTruthy()
    expect(hints.fields.find(item => item.path === 'logicalModels[*].id')).toMatchObject({ valueType: 'string' })
    expect(hints.fields.find(item => item.path === 'logicalModels[*].enabled')).toMatchObject({ valueType: 'boolean' })

    // 元素不是对象的数组只在候选表里留一条，交给 contains / empty 对整体判定。
    expect(hints.fields.find(item => item.path === 'request.body.tags')).toMatchObject({ valueType: 'array' })
    expect(paths.some(path => path.startsWith('request.body.tags['))).toBe(false)
  })

  it('遍历迭代节点向循环体暴露 route.iteration 作用域', () => {
    const target = condition('body-condition')
    const iteration: WorkflowNodeModel = {
      id: 'iteration',
      kind: 'iteration',
      name: '遍历迭代',
      enabled: true,
      description: '',
      position,
      sourcePath: 'logicalModels',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: 'route.iterationResult',
      maxIterations: 10,
    }
    const hints = resolveInputHints(
      graph([input(), iteration, target, output()], [edge('input', 'out', 'iteration'), edge('iteration', 'body', 'body-condition')]),
      target.id,
      samplePayload,
    )
    const paths = hints.fields.map(item => item.path)

    expect(paths).toEqual(expect.arrayContaining([
      'route.iteration.item',
      'route.iteration.index',
      'route.iteration.key',
      'route.iteration.total',
      'route.modelIds',
      'route.iterationResult',
    ]))
    // 作用域字段挂在 body 端口上；来源字段推不出类型时按 unknown 处理（不限制操作符）。
    expect(hints.fields.find(item => item.path === 'route.iteration.item')).toMatchObject({ valueType: 'unknown', sourcePort: 'body' })
    expect(hints.fields.find(item => item.path === 'route.iteration.index')).toMatchObject({ valueType: 'number' })
    expect(hints.fields.find(item => item.path === 'route.iteration.key')).toMatchObject({ valueType: 'string' })
    // 汇总结果与每轮收集路径走 out 端口。
    expect(hints.fields.find(item => item.path === 'route.iterationResult')).toMatchObject({ sourcePort: 'out' })
  })

  it('遍历来源是标量字段时，item 沿用该字段的类型', () => {
    const target = condition('body-condition')
    const iteration: WorkflowNodeModel = {
      id: 'iteration',
      kind: 'iteration',
      name: '遍历迭代',
      enabled: true,
      description: '',
      position,
      sourcePath: 'metadata.source',
      collectPath: '',
      collectMode: 'count',
      resultPath: '',
      maxIterations: 5,
    }
    const hints = resolveInputHints(
      graph([input(), iteration, target, output()], [edge('input', 'out', 'iteration'), edge('iteration', 'body', 'body-condition')]),
      target.id,
      samplePayload,
    )

    expect(hints.fields.find(item => item.path === 'route.iteration.item')).toMatchObject({ valueType: 'string' })
    // 未配置的收集 / 结果路径不产生空路径字段。
    expect(hints.fields.map(item => item.path)).not.toContain('')
    expect(hints.fields.find(item => item.path === 'route.modelIds')).toBeUndefined()
  })
})
