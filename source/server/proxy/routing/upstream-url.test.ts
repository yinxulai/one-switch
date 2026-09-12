import { describe, expect, it } from 'vitest'
import { resolveUpstreamUrl } from '@server/proxy/routing/upstream-url'

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
