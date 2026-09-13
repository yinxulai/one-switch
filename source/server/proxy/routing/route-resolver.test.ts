import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TransportKind } from '@common/schemas'
import { createDefaultPolicyGraph } from '@common/router/presets'
import type { RuntimeLogicalModel, WorkflowGraph } from '@common/router/types'
import { parseRouteBody, resolveRoute, toRouteHeaders } from '@server/proxy/routing/route-resolver'

const mocks = vi.hoisted(() => ({
  graph: undefined as WorkflowGraph | undefined,
  graphVersion: 0,
  models: [] as RuntimeLogicalModel[],
}))

vi.mock('@server/database/router-graph-store', () => ({
  resolveRouterGraph: async () => ({ graph: mocks.graph, version: mocks.graphVersion, savedAt: 0 }),
}))

vi.mock('@server/database/logical-model-store', () => ({
  listLogicalModels: async () => mocks.models,
}))

// 脚本 / 提示词能力要主进程的密钥库与沙箱，这里不关心它们，换成空实现即可。
vi.mock('@server/proxy/capabilities/route-capabilities', () => ({
  createRouteCapabilities: () => ({}),
}))

afterEach(() => {
  mocks.graph = undefined
  mocks.graphVersion = 0
  mocks.models = []
})

function model(id: string, enabled = true): RuntimeLogicalModel {
  return { id, name: id, enabled }
}

function useDefaultPolicy(models: RuntimeLogicalModel[]): void {
  mocks.models = models
  mocks.graph = createDefaultPolicyGraph(models)
}

function resolveWithBody(body: Record<string, unknown>, transport: TransportKind = 'http') {
  return resolveRoute({
    request: { path: '/v1/chat/completions', method: 'POST', headers: { authorization: 'Bearer test' }, body },
    clientProtocol: 'openai-completions',
    transport,
    traceId: 'exchange_1',
  })
}

describe('resolveRoute', () => {
  it('lands on the logical model named by the request when it exists', async () => {
    useDefaultPolicy([model('default'), model('team-a')])

    const resolution = await resolveWithBody({ model: 'team-a' })

    expect(resolution.logicalModelIds).toEqual(['team-a'])
    expect(resolution.stopReason).toBe('output')
    expect(resolution.trace.length).toBeGreaterThan(0)
  })

  it('falls back to the built-in default logical model when the request model is unknown', async () => {
    useDefaultPolicy([model('default'), model('team-a')])

    expect((await resolveWithBody({ model: 'gpt-4o' })).logicalModelIds).toEqual(['default'])
    expect((await resolveWithBody({})).logicalModelIds).toEqual(['default'])
  })

  it('picks the first enabled model as the fallback when the built-in default is disabled', async () => {
    useDefaultPolicy([model('default', false), model('team-a')])

    expect((await resolveWithBody({ model: 'gpt-4o' })).logicalModelIds).toEqual(['team-a'])
  })

  it('returns no landing at all when there is no enabled logical model to fall back to', async () => {
    useDefaultPolicy([])

    const resolution = await resolveWithBody({ model: 'gpt-4o' })

    // 入口按「落点为空」翻成 503，因此这里必须真的是空数组，而不是一个猜出来的 id。
    expect(resolution.logicalModelIds).toEqual([])
  })

  it('reads the graph version from the resolved snapshot and hands back the transport axis', async () => {
    useDefaultPolicy([model('default')])
    mocks.graphVersion = 7

    const resolution = await resolveWithBody({ model: 'default' }, 'websocket')

    expect(resolution.graphVersion).toBe(7)
    expect(resolution.logicalModelIds).toEqual(['default'])
    // 图把入口上报的事实原样回读：传输形态只有一个来源，没有第二个可派生的字段。
    expect(resolution.transport).toBe('websocket')
    expect(resolution.protocol).toBe('openai-completions')
  })

  it('传输形态是入口写下的，不从协议或落点推导', async () => {
    useDefaultPolicy([model('default')])

    // 同一个协议上两种传输形态都成立 —— 这正是把 SSE 做成另一档连接、或者再拆成两根轴会丢掉的信息。
    expect((await resolveWithBody({ model: 'default' }, 'http-stream')).transport).toBe('http-stream')
    expect((await resolveWithBody({ model: 'default' }, 'http')).transport).toBe('http')
  })
})

describe('route request projection', () => {
  it('flattens multi-value headers and drops the missing ones', () => {
    expect(toRouteHeaders({ 'content-type': 'application/json', accept: ['text/event-stream', 'application/json'], 'x-missing': undefined })).toEqual({
      'content-type': 'application/json',
      accept: 'text/event-stream,application/json',
    })
  })

  it('only turns json objects into a readable body', () => {
    expect(parseRouteBody(Buffer.from('{"model":"team-a"}'))).toEqual({ model: 'team-a' })
    expect(parseRouteBody(Buffer.alloc(0))).toEqual({})
    expect(parseRouteBody(Buffer.from('not json'))).toEqual({})
    // 数组与标量 JSON 都不是「请求体是对象」这个前提，同样给空对象。
    expect(parseRouteBody(Buffer.from('[1,2]'))).toEqual({})
    expect(parseRouteBody(Buffer.from('"text"'))).toEqual({})
  })
})
