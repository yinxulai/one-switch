import { describe, expect, it } from 'vitest'
import { createProtocolAuthHeaders } from './protocols'

describe('createProtocolAuthHeaders', () => {
  it.each(['openai-completions', 'openai-responses'] as const)(
    'uses bearer authorization for %s',
    protocol => {
      expect(createProtocolAuthHeaders(protocol, 'secret', null)).toEqual({
        authorization: 'Bearer secret',
      })
    },
  )

  it('uses the Anthropic key and version headers', () => {
    expect(createProtocolAuthHeaders('anthropic-messages', 'secret', null)).toEqual({
      'x-api-key': 'secret',
      'anthropic-version': '2023-06-01',
    })
  })

  it('uses an explicitly configured custom header', () => {
    expect(createProtocolAuthHeaders('openai-responses', 'secret', 'X-Custom-Key')).toEqual({
      'X-Custom-Key': 'secret',
    })
  })

  it('omits auth headers entirely when the API key is absent (local/test clusters)', () => {
    expect(createProtocolAuthHeaders('openai-completions', null, null)).toEqual({})
    expect(createProtocolAuthHeaders('openai-responses', null, null)).toEqual({})
  })

  it('keeps the Anthropic version header when the API key is absent', () => {
    expect(createProtocolAuthHeaders('anthropic-messages', null, null)).toEqual({
      'anthropic-version': '2023-06-01',
    })
  })

  it('ignores an empty custom auth header name and falls back to the protocol default', () => {
    expect(createProtocolAuthHeaders('openai-completions', 'secret', '')).toEqual({
      authorization: 'Bearer secret',
    })
  })
})
