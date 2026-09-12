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
    expect(() => protocolAdapters.resolve('anthropic-messages', 'openai-responses')).toThrow('Unsupported protocol conversion direction')
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
    // 接口级的封装描述是传输形态的唯一来源：embeddings 没有增量这一说，请求体里写
    // `stream: true` 也读不出 `http-stream`。
    expect(match?.envelope.resolveTransport({ headers: {}, body: Buffer.from('{"stream":true}'), url: null })).toBe('http')
    expect(getProtocolEndpoint('openai-completions', 'embeddings')).toBeDefined()
    expect(getProtocolEndpoint('openai-completions', 'no-such-endpoint')).toBeUndefined()
  })

  it('declares exactly one envelope per interface', () => {
    for (const descriptor of protocolDescriptors) {
      for (const endpoint of descriptor.endpoints) {
        expect(endpoint.envelope.body, `${descriptor.id}:${endpoint.id}`).toBe('json')
      }
    }
  })

  it('leaves the transport out of the interface identity', () => {
    // 协议层不知道传输形态：接口 id 里没有它，同一个入口在两种形态下都是同一条路由。
    // 把形态写进 id（`responses` / `responses-websocket`）会让「这个接口有哪几种形态」
    // 失去唯一答案；形态的合法性由传输注册表判定（见 transports/registry.test.ts）。
    expect(getProtocolEndpoint('openai-responses', 'responses')?.id).toBe('responses')
    expect(getProtocolEndpoint('openai-responses', 'responses')?.match.length).toBe(2)
    expect(getProtocolEndpoint('openai-responses', 'responses-websocket')).toBeUndefined()
  })

  it('provides an adapter for every direction declared convertible in @common/protocols', () => {
    for (const [endpointProtocol, clientProtocols] of Object.entries(CONVERTIBLE_PROTOCOLS)) {
      for (const clientProtocol of clientProtocols) {
        expect(() => protocolAdapters.resolve(clientProtocol as Protocol, endpointProtocol as Protocol)).not.toThrow()
      }
    }
  })
})
