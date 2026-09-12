import { describe, expect, it } from 'vitest'
import { resolveTransportImplementation } from './registry'

describe('传输实现解析', () => {
  it('returns the implementation serving the requested transport', () => {
    expect(resolveTransportImplementation({ transport: 'http', resolveIdleTimeoutMilliseconds: () => 0 }).transports).toEqual(['http', 'http-stream'])
    expect(resolveTransportImplementation({ transport: 'http-stream', resolveIdleTimeoutMilliseconds: () => 0 }).transports).toContain('http-stream')
  })

  it('fails loudly for a declared-but-unimplemented transport instead of falling back to http', () => {
    // `'websocket'` 是轴上的合法取值，但没有实现。静默回退到 HTTP 会拿一个 WS 地址去发 HTTP 请求，
    // 报出来的错与真实原因差得很远；规划器本来就不该产出这种候选，所以这里必须炸。
    expect(() => resolveTransportImplementation({ transport: 'websocket' })).toThrow(/WebSocket transport is not implemented/)
  })

  it('refuses an http transport without an idle timeout source instead of silently never timing out', () => {
    // 少传就是一次静默的行为降级（空闲连接永不回收），宁可在这里失败。
    expect(() => resolveTransportImplementation({ transport: 'http' })).toThrow(/resolveIdleTimeoutMilliseconds/)
  })
})
