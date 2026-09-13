import { describe, expect, it } from 'vitest'
import { anthropicToOpenAiRequest } from './request-conversion-anthropic-to-openai'

describe('anthropicToOpenAiRequest', () => {
  it('converts system, text, images, tools, and generation options', () => {
    const result = anthropicToOpenAiRequest({
      system: 'Follow policy',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          ],
        },
      ],
      tools: [{ name: 'lookup', description: 'Look up data', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'lookup' },
      max_tokens: 256,
      temperature: 0.2,
      top_p: 0.9,
      stop_sequences: ['END'],
      stream: true,
    }, 'upstream-model')

    expect(result).toEqual({
      model: 'upstream-model',
      messages: [
        { role: 'system', content: 'Follow policy' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        },
      ],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'Look up data', parameters: { type: 'object' } } }],
      tool_choice: { type: 'function', function: { name: 'lookup' } },
      max_tokens: 256,
      temperature: 0.2,
      top_p: 0.9,
      stop: ['END'],
      stream: true,
    })
  })

  it('converts tool use and tool results while filtering invalid messages', () => {
    const result = anthropicToOpenAiRequest({
      messages: [
        null,
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'weather', input: { city: 'Paris' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: [{ type: 'text', text: 'Sunny' }] }] },
      ],
      tools: [{ description: 'missing name' }],
      tool_choice: { type: 'any' },
    }, 'model')

    expect(result).toEqual({
      model: 'model',
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"city":"Paris"}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'Sunny' },
      ],
      tool_choice: 'required',
    })
  })

  it('maps every tool choice variant', () => {
    const choiceOf = (body: Record<string, unknown>): unknown => anthropicToOpenAiRequest({ messages: [], ...body }, 'm').tool_choice

    expect(choiceOf({ tool_choice: { type: 'auto' } })).toBe('auto')
    expect(choiceOf({ tool_choice: { type: 'any' } })).toBe('required')
    expect(choiceOf({ tool_choice: { type: 'none' } })).toBe('none')
    expect(choiceOf({ tool_choice: { type: 'tool', name: 'lookup' } })).toEqual({ type: 'function', function: { name: 'lookup' } })
    // 缺少 name 的 tool 选择无法映射，直接丢弃
    expect(choiceOf({ tool_choice: { type: 'tool' } })).toBeUndefined()
    expect(choiceOf({ tool_choice: { type: 'bogus' } })).toBeUndefined()
    expect(choiceOf({})).toBeUndefined()
  })

  it('turns disable_parallel_tool_use into parallel_tool_calls false', () => {
    const result = anthropicToOpenAiRequest({
      messages: [],
      tool_choice: { type: 'any', disable_parallel_tool_use: true },
    }, 'm')

    expect(result.tool_choice).toBe('required')
    expect(result.parallel_tool_calls).toBe(false)
  })

  it('preserves cache breakpoints, images, and assistant text alongside tool calls', () => {
    const result = anthropicToOpenAiRequest({
      system: [
        { type: 'text', text: 'policy', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'more' },
      ],
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'thinking' },
            { type: 'tool_use', id: 'call_1', name: 'lookup', input: { q: 'x' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call_1', content: 'ok' },
            { type: 'text', text: 'continue' },
            { type: 'image', source: { type: 'url', url: 'https://example.com/b.png' } },
            // source.type === 'file' 在 OpenAI 侧没有可复用语义
            { type: 'image', source: { type: 'file', file_id: 'file_1' } },
          ],
        },
      ],
      cache_control: { type: 'ephemeral' },
      metadata: { user_id: 'user-7' },
      stop_sequences: ['END'],
    }, 'model')

    expect(result).toEqual({
      model: 'model',
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'policy', prompt_cache_breakpoint: { mode: 'explicit' } },
            { type: 'text', text: 'more' },
          ],
        },
        {
          role: 'assistant',
          content: 'thinking',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'continue' },
            { type: 'image_url', image_url: { url: 'https://example.com/b.png' } },
          ],
        },
      ],
      prompt_cache_options: { mode: 'implicit' },
      user: 'user-7',
      stop: ['END'],
    })
  })

  it('keeps image content in tool results and drops unsupported fields', () => {
    const result = anthropicToOpenAiRequest({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: [
                { type: 'text', text: 'see' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'zz' } },
              ],
            },
          ],
        },
      ],
      tools: [{ name: '' }, { name: 'ok' }],
      top_k: 5,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      service_tier: 'standard_only',
      metadata: { user_id: '' },
      temperature: 'hot',
      top_p: Number.POSITIVE_INFINITY,
    }, 'model')

    expect(result).toEqual({
      model: 'model',
      messages: [
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: [
            { type: 'text', text: 'see' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,zz' } },
          ],
        },
      ],
      tools: [{ type: 'function', function: { name: 'ok', description: '', parameters: { type: 'object', properties: {} } } }],
    })
  })

  it('tolerates malformed messages without throwing', () => {
    const result = anthropicToOpenAiRequest({
      messages: [null, 'nope', { role: 'assistant' }, { role: 'user', content: [] }, { role: 'user', content: [{ type: 'text' }, 7] }],
    }, 'model')

    expect(result).toEqual({
      model: 'model',
      messages: [{ role: 'assistant', content: '' }],
    })
  })
})
