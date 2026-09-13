import { describe, expect, it } from 'vitest'
import { isWebSocketEndpoint, resolveUpstreamTransport, resolveUpstreamUrl } from '@server/proxy/routing/upstream-url'

describe('resolveUpstreamUrl', () => {
  it('uses the configured Provider endpoint URL without appending the client path', () => {
    expect(
      resolveUpstreamUrl(
        'https://api.example.com/openai/deployments/main/chat/completions?api-version=2025-01-01',
      ),
    ).toBe(
      'https://api.example.com/openai/deployments/main/chat/completions?api-version=2025-01-01',
    )
  })

  it('rejects non-http upstream URLs', () => {
    expect(() => resolveUpstreamUrl('file:///tmp/secret')).toThrow(
      'Unsupported upstream URL protocol',
    )
  })
})

describe('isWebSocketEndpoint', () => {
  it('reads the scheme case-insensitively and nothing else', () => {
    expect(isWebSocketEndpoint('WSS://upstream.example.com/v1/responses')).toBe(true)
    expect(isWebSocketEndpoint('wss://upstream.example.com/v1/responses')).toBe(true)
    expect(isWebSocketEndpoint('ws://upstream.example.com/v1/responses')).toBe(true)
    expect(isWebSocketEndpoint('https://upstream.example.com/v1/responses')).toBe(false)
    // 写错的地址不算 WS：那一跳自己会失败，不由这一层报错。
    expect(isWebSocketEndpoint('not-a-url')).toBe(false)
  })
})

describe('resolveUpstreamTransport', () => {
  it('mirrors the client hop on an http endpoint', () => {
    // 忠实转发：我们不替上游决定它该回整包还是逐帧，客户端要什么形态就发什么形态。
    expect(resolveUpstreamTransport('https://upstream.example.com/v1/responses', 'http-stream')).toBe('http-stream')
    expect(resolveUpstreamTransport('https://upstream.example.com/v1/responses', 'http')).toBe('http')
  })

  it('reports websocket for a ws endpoint no matter what the client asked for', () => {
    expect(resolveUpstreamTransport('wss://upstream.example.com/v1/responses', 'http-stream')).toBe('websocket')
    expect(resolveUpstreamTransport('ws://upstream.example.com/v1/responses', 'http')).toBe('websocket')
  })
})
