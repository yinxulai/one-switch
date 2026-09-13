import { describe, expect, it } from 'vitest'
import { ACCESS_CLIENT_PROFILES, ACCESS_CLIENT_PROFILE_LIST, buildBaseUrl, buildEndpointUrl } from './clients'

const ORIGIN = 'http://127.0.0.1:19300'

describe('接入地址拼装', () => {
  it('OpenAI 兼容客户端的 Base URL 带 /v1', () => {
    // 客户端自己只拼 /chat/completions、/responses，所以要替它带上 /v1。
    expect(buildBaseUrl(ORIGIN, ACCESS_CLIENT_PROFILES.openai)).toBe('http://127.0.0.1:19300/v1')
  })

  it('Anthropic 客户端的 Base URL 到端口为止', () => {
    // 客户端自己会补 /v1/messages，这里再多一段 /v1 就变成 /v1/v1/messages，代理认不出。
    expect(buildBaseUrl(ORIGIN, ACCESS_CLIENT_PROFILES.anthropic)).toBe('http://127.0.0.1:19300')
  })

  it('两类客户端的 Base URL 不相同，复制时不会拿错版本', () => {
    const urls = ACCESS_CLIENT_PROFILE_LIST.map(profile => buildBaseUrl(ORIGIN, profile))
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('完整接口地址是根地址加路径，且不会拼出重复的 /v1', () => {
    const urls = ACCESS_CLIENT_PROFILE_LIST.flatMap(profile =>
      profile.endpoints.map(endpoint => buildEndpointUrl(ORIGIN, endpoint.path)))

    expect(urls).toEqual([
      'http://127.0.0.1:19300/v1/chat/completions',
      'http://127.0.0.1:19300/v1/responses',
      'http://127.0.0.1:19300/v1/models',
      'http://127.0.0.1:19300/v1/messages',
      'http://127.0.0.1:19300/v1/models',
    ])
    expect(urls.some(url => url.includes('/v1/v1'))).toBe(false)
  })

  it('接口复制 key 全局唯一，复制回执不会串到别的行', () => {
    const keys = ACCESS_CLIENT_PROFILE_LIST.flatMap(profile => profile.endpoints.map(endpoint => endpoint.key))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('根地址为空时给出空串，页面据此显示占位符并禁用复制', () => {
    expect(buildEndpointUrl('', '/v1/chat/completions')).toBe('')
    expect(buildBaseUrl('', ACCESS_CLIENT_PROFILES.openai)).toBe('')
  })
})
