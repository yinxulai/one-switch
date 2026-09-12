import { describe, expect, it } from 'vitest'
import { openAiToAnthropicRequest } from './request-conversion-openai-to-anthropic'

describe('openAiToAnthropicRequest', () => {
  it('converts system messages, multimodal content, tools, and options', () => {
    const result = openAiToAnthropicRequest({
      messages: [
        { role: 'system', content: 'System one' },
        { role: 'developer', content: 'System two' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xyz' } },
            { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
          ],
        },
      ],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object' } } }],
      tool_choice: 'required',
      max_tokens: 300,
      temperature: 0.3,
      top_p: 0.8,
      stop: ['DONE'],
      stream: true,
    }, 'upstream-model')

    expect(result).toEqual({
      model: 'upstream-model',
      system: 'System one\n\nSystem two',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'xyz' } },
          { type: 'image', source: { type: 'url', url: 'https://example.com/image.png' } },
        ],
      }],
      max_tokens: 300,
      temperature: 0.3,
      top_p: 0.8,
      stop_sequences: ['DONE'],
      stream: true,
      tools: [{ name: 'lookup', description: 'Lookup', input_schema: { type: 'object' } }],
      tool_choice: { type: 'any' },
    })
  })

  it('converts tool calls and results and tolerates malformed arguments', () => {
    const result = openAiToAnthropicRequest({
      messages: [
        { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', function: { name: 'lookup', arguments: '{bad' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'result' },
      ],
      tool_choice: 'none',
    }, 'model')

    expect(result).toEqual({
      model: 'model',
      max_tokens: 4096,
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'lookup', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'result' }] },
      ],
      tool_choice: { type: 'none' },
    })
  })

  it('merges consecutive tool results into a single user message and keeps text before tool_use', () => {
    const result = openAiToAnthropicRequest({
      messages: [
        {
          role: 'assistant',
          content: 'checking',
          tool_calls: [
            { id: 'call_1', function: { name: 'a', arguments: '{"x":1}' } },
            { id: 'call_2', function: { name: 'b', arguments: 'not-json' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'one' },
        { role: 'tool', tool_call_id: 'call_2', content: [{ type: 'text', text: 'two' }] },
        {
          role: 'tool',
          tool_call_id: 'call_3',
          content: [
            { type: 'text', text: 'see' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,zz' } },
          ],
        },
        { role: 'user', content: 'thanks' },
      ],
    }, 'model')

    expect(result.messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 'call_1', name: 'a', input: { x: 1 } },
          { type: 'tool_use', id: 'call_2', name: 'b', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'one' },
          { type: 'tool_result', tool_use_id: 'call_2', content: 'two' },
          {
            type: 'tool_result',
            tool_use_id: 'call_3',
            content: [
              { type: 'text', text: 'see' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'zz' } },
            ],
          },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'thanks' }] },
    ])
  })

  it('maps every tool choice variant plus the parallel tool call switch', () => {
    const choiceOf = (body: Record<string, unknown>): unknown => openAiToAnthropicRequest({ messages: [], ...body }, 'm').tool_choice

    expect(choiceOf({ tool_choice: 'auto' })).toEqual({ type: 'auto' })
    expect(choiceOf({ tool_choice: 'required' })).toEqual({ type: 'any' })
    expect(choiceOf({ tool_choice: 'none' })).toEqual({ type: 'none' })
    expect(choiceOf({ tool_choice: { type: 'function', function: { name: 'lookup' } } })).toEqual({ type: 'tool', name: 'lookup' })
    expect(choiceOf({ tool_choice: 'auto', parallel_tool_calls: false })).toEqual({ type: 'auto', disable_parallel_tool_use: true })
    expect(choiceOf({ tool_choice: { type: 'function', function: { name: 'lookup' } }, parallel_tool_calls: false }))
      .toEqual({ type: 'tool', name: 'lookup', disable_parallel_tool_use: true })
    // 没有 tool_choice 但禁用了并行调用时，Anthropic 仍需要一个占位选择
    expect(choiceOf({ parallel_tool_calls: false })).toEqual({ type: 'auto', disable_parallel_tool_use: true })
    expect(choiceOf({ tool_choice: { type: 'function', function: {} } })).toBeUndefined()
    expect(choiceOf({ tool_choice: { type: 'bogus' } })).toBeUndefined()
    expect(choiceOf({})).toBeUndefined()
  })

  it('normalizes stop sequences, user metadata, and cache controls', () => {
    const stringStop = openAiToAnthropicRequest({ messages: [], stop: 'END' }, 'm')
    expect(stringStop.stop_sequences).toEqual(['END'])

    const arrayStop = openAiToAnthropicRequest({ messages: [], stop: ['a', 'b'] }, 'm')
    expect(arrayStop.stop_sequences).toEqual(['a', 'b'])

    expect(openAiToAnthropicRequest({ messages: [] }, 'm')).not.toHaveProperty('stop_sequences')

    expect(openAiToAnthropicRequest({ messages: [], user: 'user-42' }, 'm').metadata).toEqual({ user_id: 'user-42' })
    expect(openAiToAnthropicRequest({ messages: [], user: '' }, 'm')).not.toHaveProperty('metadata')

    expect(openAiToAnthropicRequest({ messages: [], prompt_cache_options: { mode: 'implicit' } }, 'm').cache_control)
      .toEqual({ type: 'ephemeral' })
    expect(openAiToAnthropicRequest({ messages: [], prompt_cache_options: { mode: 'explicit' } }, 'm'))
      .not.toHaveProperty('cache_control')
  })

  it('keeps explicit prompt cache breakpoints on system and user text blocks', () => {
    const result = openAiToAnthropicRequest({
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'policy', prompt_cache_breakpoint: { mode: 'explicit' } },
            { type: 'text', text: 'more' },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'question', prompt_cache_breakpoint: {} },
            { type: 'text', text: 'implicit', prompt_cache_breakpoint: { mode: 'implicit' } },
          ],
        },
      ],
    }, 'model')

    expect(result.system).toEqual([
      { type: 'text', text: 'policy', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'more' },
    ])
    expect(result.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'question', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'implicit' },
        ],
      },
    ])
  })

  it('drops unusable content parts and tools without throwing', () => {
    const result = openAiToAnthropicRequest({
      messages: [
        null,
        'not-a-message',
        // 空 content 的 user 消息在 Anthropic 侧无意义，直接丢弃
        { role: 'user', content: [] },
        { role: 'user', content: [{ type: 'refusal', refusal: 'no' }, { type: 'text' }, 42, { type: 'text', text: 'kept' }] },
        {
          role: 'assistant',
          tool_calls: [
            { id: 'call_1', function: { arguments: '{}' } },
            { id: 'call_2', function: { name: 'ok', arguments: '{"a":1}' } },
            null,
          ],
        },
      ],
      tools: [{ type: 'function', function: {} }, { type: 'function', function: { name: 'ok' } }],
    }, 'model')

    expect(result.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'kept' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_2', name: 'ok', input: { a: 1 } }] },
    ])
    expect(result.tools).toEqual([{ name: 'ok', description: '', input_schema: { type: 'object', properties: {} } }])
    expect(result.max_tokens).toBe(4096)
  })

  it('passes through sampling parameters and stream flag only when present', () => {
    expect(openAiToAnthropicRequest({ messages: [] }, 'm')).toEqual({ model: 'm', messages: [], max_tokens: 4096 })
    expect(openAiToAnthropicRequest({ messages: [], stream: false, temperature: 0 }, 'm'))
      .toEqual({ model: 'm', messages: [], max_tokens: 4096, temperature: 0 })
    expect(openAiToAnthropicRequest({ messages: [], temperature: 'hot', top_p: Number.NaN }, 'm'))
      .toEqual({ model: 'm', messages: [], max_tokens: 4096 })
  })
})
