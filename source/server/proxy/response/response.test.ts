import { describe, expect, it } from 'vitest'
import { classifyHealthFailure, classifyUpstreamStatus } from '@server/proxy/response/response'

describe('classifyUpstreamStatus', () => {
  it.each([200, 201, 204])('treats %i as a successful upstream response', status => {
    expect(classifyUpstreamStatus(status)).toBe('success')
  })

  it.each([300, 301, 399, 400, 401, 403, 404, 405, 408, 409, 422, 429, 500, 502, 503, 599])('allows failover for %i', status => {
    expect(classifyUpstreamStatus(status)).toBe('failover')
  })
})

describe('classifyHealthFailure', () => {
  it.each([null, 401, 403])('attributes provider-wide failure %s to the provider', status => {
    expect(classifyHealthFailure({ statusCode: status })).toBe('provider')
  })

  it.each([404, 408, 500, 503])('attributes model-scoped failure %i to the provider model', status => {
    expect(classifyHealthFailure({ statusCode: status })).toBe('provider-model')
  })

  it('attributes provider-wide rate limit responses to the provider', () => {
    expect(classifyHealthFailure({ statusCode: 429, responseBody: '{"error":"API key rate limit exceeded"}' })).toBe('provider')
  })

  it('keeps ambiguous rate limit responses scoped to the provider model', () => {
    expect(classifyHealthFailure({ statusCode: 429, responseBody: '{"error":"rate limit exceeded"}' })).toBe('provider-model')
  })

  it.each([400, 409, 422])('does not change health for terminal request error %i', status => {
    expect(classifyHealthFailure({ statusCode: status })).toBe('none')
  })

  it('attributes a transport mismatch to the provider model even though the status is 2xx', () => {
    // 上游用 200 + 非 SSE 正文回答了一个要增量传输的请求：状态码看起来是成功的，
    // 违约事实因此必须由调用方显式告知，否则这类失败会被当成没发生。
    expect(classifyHealthFailure({ statusCode: 200, responseBody: '{"choices":[]}', transportMismatch: true })).toBe('provider-model')
  })
})
