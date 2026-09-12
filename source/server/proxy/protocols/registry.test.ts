import { describe, expect, it } from 'vitest'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import type { Protocol } from '@common/schemas'
import { protocolAdapters, protocolDescriptors, detectProtocolFromRequest, getProtocolDescriptor, getProtocolEndpoint, listProtocolRoutes, matchProtocolEndpoint } from './registry'
import { createRequestContext } from '@server/proxy/request/request-context'

function context(body: Record<string, unknown>, clientProtocol: 'openai-completions' | 'openai-responses' | 'anthropic-messages') {
  return createRequestContext({
    requestId: 'req_test',
    logicalModelId: 'default',
    clientProtocol,
    method: 'POST',
    path: '/v1/test',
    requestBody: Buffer.from(JSON.stringify(body)),
  })
}

describe('protocol adapter registry', () => {
  it('resolves native adapters and rewrites the provider model', () => {
    const adapter = protocolAdapters.resolve('openai-completions', 'openai-completions')
    const body = JSON.parse(adapter.prepareRequest(context({ model: 'logical', messages: [] }, 'openai-completions'), 'provider-model').toString())
    const response = Buffer.from(JSON.stringify({ id: 'resp_native', model: 'provider-model' }))

    expect(adapter.clientProtocol).toBe('openai-completions')
    expect(adapter.endpointProtocol).toBe('openai-completions')
    expect(adapter.requiresResponseConversion).toBe(false)
    expect(body.model).toBe('provider-model')
    expect(adapter.createStreamConverter()).toBeNull()
    expect(adapter.convertResponse(response)).toBe(response)
  })

  it('resolves conversion adapters and preserves streaming conversion', () => {
    const adapter = protocolAdapters.resolve('openai-completions', 'anthropic-messages')
    const body = JSON.parse(adapter.prepareRequest(context({ model: 'logical', messages: [{ role: 'user', content: 'hi' }], stream: true }, 'openai-completions'), 'provider-model').toString())

    expect(adapter.requiresResponseConversion).toBe(true)
    expect(body.model).toBe('provider-model')
    expect(body.messages[0].content[0].text).toBe('hi')
    const converter = adapter.createStreamConverter()
    expect(converter).not.toBeNull()
    expect(adapter.finishStream(converter!)).toBe('data: [DONE]\n\n')
    const response = JSON.parse(adapter.convertResponse(Buffer.from(JSON.stringify({
      id: 'msg_test',
      type: 'message',
      model: 'provider-model',
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: 'end_turn',
    }))).toString())
    expect(response.object).toBe('chat.completion')
    expect(response.choices[0].message.content).toBe('hello')
    expect(() => protocolAdapters.resolve('anthropic-messages', 'openai-responses')).toThrow('不支持的协议转换方向')
  })
})

describe('protocol descriptors', () => {
  it('exposes exactly one descriptor per protocol, reachable through the registry', () => {
    expect(protocolDescriptors.map(descriptor => descriptor.id).sort()).toEqual([
      'anthropic-messages',
      'openai-completions',
      'openai-responses',
    ])
    for (const descriptor of protocolDescriptors) {
      expect(getProtocolDescriptor(descriptor.id)).toBe(descriptor)
      expect(descriptor.endpoints.length).toBeGreaterThan(0)
    }
  })

  it('declares a native adapter for every protocol', () => {
    for (const descriptor of protocolDescriptors) {
      expect(protocolAdapters.resolve(descriptor.id, descriptor.id).kind).toBe('native')
    }
  })

  it('declares every entry route exactly once', () => {
    const keys = listProtocolRoutes().map(route => `${route.method} ${route.path}`)
    expect(keys.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it.each([
    ['/v1/chat/completions', 'openai-completions'],
    ['/chat/completions', 'openai-completions'],
    ['/v1/completions', 'openai-completions'],
    ['/completions/', 'openai-completions'],
    ['/v1/embeddings', 'openai-completions'],
    ['/embeddings?encoding_format=float', 'openai-completions'],
    ['/v1/responses?stream=true', 'openai-responses'],
    ['/responses/', 'openai-responses'],
    ['/v1/messages?beta=true', 'anthropic-messages'],
    ['/messages/', 'anthropic-messages'],
  ] as const)('detects %s as %s', (path, expected) => {
    expect(detectProtocolFromRequest('POST', path)).toBe(expected)
    // 方法大小写与尾斜杠、查询串都不应影响匹配。
    expect(detectProtocolFromRequest('post', path)).toBe(expected)
  })

  it.each([
    '/v1/models',
    '/models',
    '/v1/completions/extra',
    '/v1beta/models/gemini-2.5-pro:generateContent',
    '/v1/unknown',
    '/health',
    '/',
  ])('does not claim unsupported path %s', path => {
    expect(detectProtocolFromRequest('POST', path)).toBeNull()
  })

  it('matches on method, not only on path', () => {
    // 同一路径在不同方法下属于不同接口：将来 WS 握手（GET）与 HTTP 透传（POST）必须能区分开。
    expect(detectProtocolFromRequest('GET', '/v1/messages')).toBeNull()
    expect(detectProtocolFromRequest('POST', '/v1/messages')).toBe('anthropic-messages')
  })

  it('resolves the interface and its envelope together', () => {
    const match = matchProtocolEndpoint('POST', '/v1/embeddings')
    expect(match?.protocol).toBe('openai-completions')
    expect(match?.endpointId).toBe('embeddings')
    // 接口级的封装描述是「交付方式」的唯一来源：embeddings 没有增量交付的概念。
    expect(match?.envelope.resolveDelivery({ headers: {}, body: Buffer.from('{"stream":true}'), url: null })).toBe('buffered')
    expect(getProtocolEndpoint('openai-completions', 'embeddings')).toBeDefined()
    expect(getProtocolEndpoint('openai-completions', 'no-such-endpoint')).toBeUndefined()
  })

  it('declares one envelope implementation per interface and transport', () => {
    for (const descriptor of protocolDescriptors) {
      for (const endpoint of descriptor.endpoints) {
        expect(Object.keys(endpoint.envelopes).length, `${descriptor.id}:${endpoint.id}`).toBeGreaterThan(0)
        for (const envelope of Object.values(endpoint.envelopes)) {
          expect(envelope?.body).toBe('json')
        }
      }
    }
  })

  it('rejects a transport an interface does not declare', () => {
    // `'websocket'` 是轴上的合法取值，但今天没有任何接口声明 WS 封装，因此**每一条**路由在
    // websocket 上都必须为 null。这个断言同时也是「未实现的传输不会静默地落到某个处理器」的证据：
    // 一旦有人加了 WS 封装却忘了真实现，这里会先响。
    const websocketRoutes = listProtocolRoutes()
      .filter(route => matchProtocolEndpoint(route.method, route.path, 'websocket') !== null)
      .map(route => `${route.method} ${route.path}`)
    expect(websocketRoutes).toEqual([])
    expect(matchProtocolEndpoint('POST', '/v1/responses', 'websocket')).toBeNull()
    expect(matchProtocolEndpoint('GET', '/v1/responses', 'websocket')).toBeNull()
    expect(matchProtocolEndpoint('POST', '/chat/completions', 'websocket')).toBeNull()
  })

  it('keeps transport out of the interface identity', () => {
    // 传输是接口的属性，不是接口 id 的一部分。把传输写进 id（`responses` / `responses-websocket`）
    // 会让「这个接口支持哪些传输」失去唯一答案，也会让只改传输的改动看起来像新增接口。
    // 现在 WS 没有实现，这条不变式反而更需要被钉住——它正是 WS 回来时不用改 id 的原因。
    expect(matchProtocolEndpoint('POST', '/v1/responses', 'http')?.endpointId).toBe('responses')
    expect(getProtocolEndpoint('openai-responses', 'responses')?.match.length).toBe(2)
    expect(getProtocolEndpoint('openai-responses', 'responses-websocket')).toBeUndefined()
  })

  it('reports the transports each entry route is valid on', () => {
    const byKey = new Map(listProtocolRoutes().map(route => [`${route.method} ${route.path}`, [...route.transports].sort()]))
    // 没写 `transport` 的匹配规则归集出接口声明的全部传输；今天每个入口都只有 http。
    expect(byKey.get('POST /v1/chat/completions')).toEqual(['http'])
    expect(byKey.get('POST /v1/responses')).toEqual(['http'])
    // 传输不在入口的集合里 = 该传输上不存在这个入口，而不是「路径不认识」。
    expect(matchProtocolEndpoint('GET', '/v1/responses', 'http')).toBeNull()
    expect(matchProtocolEndpoint('GET', '/v1/chat/completions', 'http')).toBeNull()
  })

  it('provides an adapter for every direction declared convertible in @common/protocols', () => {
    for (const [endpointProtocol, clientProtocols] of Object.entries(CONVERTIBLE_PROTOCOLS)) {
      for (const clientProtocol of clientProtocols) {
        expect(() => protocolAdapters.resolve(clientProtocol as Protocol, endpointProtocol as Protocol)).not.toThrow()
      }
    }
  })
})
