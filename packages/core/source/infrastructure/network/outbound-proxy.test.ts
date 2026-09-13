import { describe, expect, it } from 'vitest'
import { normalizeProxyUrl, redactProxyUrl, resolveChromiumProxyRule, shouldBypassProxy, validateOutboundProxyModeAndUrl } from './outbound-proxy'

describe('outbound proxy utilities', () => {
  it('normalizes supported URLs and preserves credentials', () => {
    expect(normalizeProxyUrl(' http://user:pass@127.0.0.1:7890 ')).toBe('http://user:pass@127.0.0.1:7890')
    expect(normalizeProxyUrl('socks5://localhost:1080')).toBe('socks5://localhost:1080')
  })

  it('rejects unsupported URL content', () => {
    expect(() => normalizeProxyUrl('ftp://localhost:21')).toThrow('only supports HTTP, HTTPS and SOCKS')
    expect(() => normalizeProxyUrl('http://localhost:7890/path')).toThrow('may only contain the protocol, host, port and credentials')
    expect(() => normalizeProxyUrl('')).toThrow('A custom proxy URL is required')
  })

  it('redacts credentials without hiding the endpoint', () => {
    expect(redactProxyUrl('http://user:secret@proxy.example:8080')).toBe('http://***:***@proxy.example:8080')
  })

  it('matches bypass hosts, ports and wildcard domains', () => {
    const bypass = 'localhost,127.0.0.1,*.example.com,api.test:8443,<local>'
    expect(shouldBypassProxy('http://localhost/path', bypass)).toBe(true)
    expect(shouldBypassProxy('http://[::1]/path', '::1')).toBe(true)
    expect(shouldBypassProxy('https://a.example.com/path', bypass)).toBe(true)
    expect(shouldBypassProxy('https://api.test:8443/path', bypass)).toBe(true)
    expect(shouldBypassProxy('https://api.test/path', bypass)).toBe(false)
    expect(shouldBypassProxy('https://other.test/path', bypass)).toBe(false)
  })

  it('converts Chromium proxy rules in priority order', () => {
    expect(resolveChromiumProxyRule('PROXY proxy.test:8080; DIRECT', 'https://example.com')).toBe('http://proxy.test:8080')
    expect(resolveChromiumProxyRule('SOCKS5 proxy.test:1080', 'https://example.com')).toBe('socks5://proxy.test:1080')
    expect(resolveChromiumProxyRule('DIRECT', 'https://example.com')).toBe('')
  })

  it('validates custom mode URL and ignores non-custom mode', () => {
    expect(() => validateOutboundProxyModeAndUrl('custom', 'http://127.0.0.1:7890')).not.toThrow()
    expect(() => validateOutboundProxyModeAndUrl('custom', 'ftp://127.0.0.1:21')).toThrow('only supports HTTP, HTTPS and SOCKS')
    expect(() => validateOutboundProxyModeAndUrl('system', '')).not.toThrow()
    expect(() => validateOutboundProxyModeAndUrl('direct', '')).not.toThrow()
  })
})
