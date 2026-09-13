import { describe, expect, it } from 'vitest'
import { isWildcardHost, resolveProxyOrigin } from './proxy-origin'

describe('resolveProxyOrigin', () => {
  it('回环地址原样拼出', () => {
    expect(resolveProxyOrigin('127.0.0.1', 19300)).toBe('http://127.0.0.1:19300')
  })

  it('局域网地址原样使用', () => {
    expect(resolveProxyOrigin('192.168.1.5', 8080)).toBe('http://192.168.1.5:8080')
  })

  it('通配地址回落到回环地址', () => {
    expect(resolveProxyOrigin('0.0.0.0', 19300)).toBe('http://127.0.0.1:19300')
    expect(resolveProxyOrigin('::', 19300)).toBe('http://127.0.0.1:19300')
    expect(resolveProxyOrigin('[::]', 19300)).toBe('http://127.0.0.1:19300')
  })

  it('IPv6 补方括号，否则端口会被当成地址的一部分', () => {
    expect(resolveProxyOrigin('::1', 19300)).toBe('http://[::1]:19300')
    expect(resolveProxyOrigin('2001:db8::1', 19300)).toBe('http://[2001:db8::1]:19300')
  })

  it('host 或 port 缺失时返回 null，不拼半个地址', () => {
    expect(resolveProxyOrigin(null, 19300)).toBeNull()
    expect(resolveProxyOrigin('', 19300)).toBeNull()
    expect(resolveProxyOrigin('127.0.0.1', null)).toBeNull()
    expect(resolveProxyOrigin('127.0.0.1', 0)).toBeNull()
  })
})

describe('isWildcardHost', () => {
  it('只认通配地址', () => {
    expect(isWildcardHost('0.0.0.0')).toBe(true)
    expect(isWildcardHost('::')).toBe(true)
    expect(isWildcardHost('[::]')).toBe(true)
  })

  it('空值与真实地址都不算通配', () => {
    expect(isWildcardHost('')).toBe(false)
    expect(isWildcardHost(null)).toBe(false)
    expect(isWildcardHost(undefined)).toBe(false)
    expect(isWildcardHost('127.0.0.1')).toBe(false)
    expect(isWildcardHost('::1')).toBe(false)
  })
})
