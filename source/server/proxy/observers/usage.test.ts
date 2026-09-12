import { describe, expect, it } from 'vitest'
import { createUsageTracker, emptyUsage, extractTokenUsage, hasOutput } from './usage'

describe('usage tracker', () => {
  it('starts empty so that "not reported" is never mistaken for zero', () => {
    expect(emptyUsage()).toEqual({
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      cachedInputTokens: null,
      cacheCreationInputTokens: null,
      rawUsage: null,
    })
  })

  it('reads usage from nested provider fields', () => {
    const tracker = createUsageTracker()
    tracker.consumeJson('{"response":{"usage":{"input_tokens":12,"output_tokens":7}}}')
    expect(tracker.usage()).toMatchObject({ inputTokens: 12, outputTokens: 7 })
  })

  it('reads reasoning tokens from provider usage details', () => {
    const tracker = createUsageTracker()
    tracker.consumeJson('{"usage":{"prompt_tokens":12,"completion_tokens":7,"completion_tokens_details":{"reasoning_tokens":3}}}')
    expect(tracker.usage().reasoningTokens).toBe(3)
  })

  it.each([
    ['Gemini camel-case metadata', { usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, cachedContentTokenCount: 12 } }, { inputTokens: 30, outputTokens: 4, cachedInputTokens: 12 }],
    ['Gemini total cached tokens', { usage: { input_tokens: 30, output_tokens: 4, total_cached_tokens: 12 } }, { inputTokens: 30, outputTokens: 4, cachedInputTokens: 12 }],
    ['OpenAI prompt cache write details', { usage: { prompt_tokens: 30, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 12, cache_write_tokens: 6 } } }, { cachedInputTokens: 12, cacheCreationInputTokens: 6 }],
    ['OpenAI input cache write details', { usage: { input_tokens: 30, output_tokens: 4, input_tokens_details: { cached_tokens: 12, cache_write_tokens: 6 } } }, { inputTokens: 30, cachedInputTokens: 12, cacheCreationInputTokens: 6 }],
    ['Anthropic cache creation TTL details', { usage: { input_tokens: 12, output_tokens: 4, cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 7 } } }, { inputTokens: 24, cacheCreationInputTokens: 12 }],
    ['Anthropic cache read and write totals', { usage: { input_tokens: 8, output_tokens: 4, cache_read_input_tokens: 7, cache_creation_input_tokens: 5 } }, { inputTokens: 20, cachedInputTokens: 7, cacheCreationInputTokens: 5 }],
  ])('reads %s', (_name, body, expected) => {
    const tracker = createUsageTracker()
    tracker.consumeJson(JSON.stringify(body))
    expect(tracker.usage()).toMatchObject(expected)
  })

  it('preserves zero cache metrics', () => {
    const tracker = createUsageTracker()
    tracker.consumeJson('{"usage":{"prompt_tokens":3,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":0}}}')
    expect(tracker.usage()).toMatchObject({ cachedInputTokens: 0, cacheCreationInputTokens: 0 })
  })

  it('merges usage reported across several SSE events', () => {
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"usage":{"prompt_tokens":3}}\n\n')
    tracker.consumeSseChunk('data: {"usage":{"completion_tokens":7}}\n\n')
    expect(tracker.usage()).toMatchObject({ inputTokens: 3, outputTokens: 7 })
  })

  it('parses split SSE lines and ignores the DONE sentinel', () => {
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"usage":{"prompt_tokens":3}}\n\n')
    tracker.consumeSseChunk('data: [DONE]\n')
    expect(tracker.usage().inputTokens).toBe(3)
  })

  it('flushes a trailing SSE line that never got its newline', () => {
    const tracker = createUsageTracker()
    tracker.consumeSseChunk('data: {"usage":{"prompt_tokens":5}}')
    expect(tracker.usage().inputTokens).toBeNull()
    tracker.flush()
    expect(tracker.usage().inputTokens).toBe(5)
  })

  it('keeps forwarding when an upstream event is not valid JSON', () => {
    const tracker = createUsageTracker()
    expect(tracker.consumeJson('not json')).toBe(false)
    expect(tracker.usage()).toMatchObject({ inputTokens: null })
  })
})

describe('first output detection', () => {
  it('ignores role-only, usage-only and sentinel events', () => {
    const tracker = createUsageTracker()
    expect(tracker.consumeSseChunk('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')).toBe(false)
    expect(tracker.consumeSseChunk('data: {"usage":{"prompt_tokens":3}}\n\n')).toBe(false)
    expect(tracker.consumeSseChunk('data: [DONE]\n')).toBe(false)
    expect(tracker.consumeSseChunk('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n')).toBe(true)
  })

  it('recognizes text output for Anthropic streams only', () => {
    const tracker = createUsageTracker()
    expect(tracker.consumeSseChunk('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n')).toBe(false)
    expect(tracker.consumeSseChunk('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n')).toBe(true)
  })

  it('recognizes text output for Responses streams only', () => {
    const tracker = createUsageTracker()
    expect(tracker.consumeSseChunk('data: {"type":"response.created"}\n\n')).toBe(false)
    expect(tracker.consumeSseChunk('data: {"type":"response.output_text.delta","delta":"hello"}\n\n')).toBe(true)
  })

  it('flags JSON bodies that carry generated content', () => {
    expect(hasOutput({ choices: [{ message: { content: 'hello' } }] })).toBe(true)
    expect(hasOutput({ choices: [{ message: { content: '' } }] })).toBe(false)
    expect(hasOutput({ usage: { prompt_tokens: 3 } })).toBe(false)
  })
})

describe('token usage extraction', () => {
  it('returns an empty reading for a payload without usage', () => {
    expect(extractTokenUsage({ id: 'resp-1' })).toMatchObject({ inputTokens: null, rawUsage: null })
  })

  it('keeps the provider payload so that unknown fields are not lost', () => {
    expect(extractTokenUsage({ usage: { prompt_tokens: 3, vendor_field: 'kept' } }).rawUsage).toMatchObject({ prompt_tokens: 3, vendor_field: 'kept' })
  })
})
