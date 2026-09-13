import { describe, expect, it } from 'vitest'
import { responsesToOpenAiRequest } from './request-conversion-responses-to-openai'

describe('responsesToOpenAiRequest', () => {
  it('converts instructions, text, images, and request options', () => {
    const result = responsesToOpenAiRequest({
      instructions: 'Be concise',
      input: [
        'plain input',
        { role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
        { role: 'user', content: [{ type: 'input_image', image_url: { url: 'https://example.com/a.png' } }] },
      ],
      max_output_tokens: 512,
      temperature: 0.4,
      top_p: 0.7,
      stream: true,
      prompt_cache_key: 'cache-key',
      prompt_cache_retention: '24h',
    }, 'upstream-model')

    expect(result).toEqual({
      model: 'upstream-model',
      messages: [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'plain input' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] },
      ],
      max_tokens: 512,
      temperature: 0.4,
      top_p: 0.7,
      stream: true,
      prompt_cache_key: 'cache-key',
      prompt_cache_retention: '24h',
    })
  })

  it('converts function calls and outputs and skips invalid input', () => {
    const result = responsesToOpenAiRequest({
      input: [
        null,
        { role: 'assistant', content: [{ type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"id":1}' }] },
        { role: 'user', content: [{ type: 'function_call_output', call_id: 'call_1', output: 'found' }] },
      ],
    }, 'model')

    expect(result).toEqual({
      model: 'model',
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'found' },
      ],
    })
  })

  it('converts top-level function call items and merges consecutive calls', () => {
    const result = responsesToOpenAiRequest({
      input: [
        { type: 'function_call', call_id: 'call_1', name: 'a', arguments: '{"x":1}' },
        { type: 'function_call', call_id: 'call_2', name: 'b' },
        { type: 'function_call_output', call_id: 'call_1', output: 'one' },
        { type: 'function_call_output', call_id: 'call_2', output: [{ type: 'output_text', text: 'two' }] },
      ],
    }, 'model')

    expect(result.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'a', arguments: '{"x":1}' } },
          { id: 'call_2', type: 'function', function: { name: 'b', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'one' },
      { role: 'tool', tool_call_id: 'call_2', content: 'two' },
    ])
  })

  it('accepts string input and drops reasoning and reference items', () => {
    expect(responsesToOpenAiRequest({ input: 'hello' }, 'm').messages).toEqual([{ role: 'user', content: 'hello' }])

    const result = responsesToOpenAiRequest({
      input: [
        { type: 'reasoning', summary: [] },
        { type: 'item_reference', id: 'msg_1' },
        { role: 'developer', content: 'dev' },
      ],
    }, 'm')

    expect(result.messages).toEqual([{ role: 'system', content: 'dev' }])
  })

  it('flushes buffered text before nested tool items to keep order', () => {
    const result = responsesToOpenAiRequest({
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'here' },
            { type: 'function_call_output', call_id: 'call_1', output: 'done' },
          ],
        },
      ],
    }, 'm')

    expect(result.messages).toEqual([
      { role: 'user', content: 'here' },
      { role: 'tool', tool_call_id: 'call_1', content: 'done' },
    ])
  })

  it('maps tools, tool choice, text format, reasoning effort, and passthrough fields', () => {
    const result = responsesToOpenAiRequest({
      input: 'hi',
      tools: [
        { type: 'function', name: 'lookup', description: 'Look up', parameters: { type: 'object' }, strict: true },
        // 非 function 类型的内置工具在 Chat Completions 中没有对应能力
        { type: 'web_search' },
      ],
      tool_choice: { type: 'function', name: 'lookup' },
      text: { format: { type: 'json_schema', name: 'answer', schema: { type: 'object' }, strict: true, description: 'desc' } },
      reasoning: { effort: 'high' },
      parallel_tool_calls: false,
      metadata: { trace: 't' },
      user: 'user-1',
      prompt_cache_options: { mode: 'implicit' },
      prompt_cache_key: 'key',
      prompt_cache_retention: '24h',
    }, 'model')

    expect(result).toMatchObject({
      model: 'model',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'Look up', parameters: { type: 'object' }, strict: true } }],
      tool_choice: { type: 'function', function: { name: 'lookup' } },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', schema: { type: 'object' }, strict: true, description: 'desc' },
      },
      reasoning_effort: 'high',
      parallel_tool_calls: false,
      metadata: { trace: 't' },
      user: 'user-1',
      prompt_cache_options: { mode: 'implicit' },
      prompt_cache_key: 'key',
      prompt_cache_retention: '24h',
    })
  })

  it('maps every tool choice variant and simple text format', () => {
    const choiceOf = (choice: unknown): unknown => responsesToOpenAiRequest({ input: 'hi', tool_choice: choice }, 'm').tool_choice

    expect(choiceOf('auto')).toBe('auto')
    expect(choiceOf('none')).toBe('none')
    expect(choiceOf('required')).toBe('required')
    expect(choiceOf({ type: 'function', name: 'lookup' })).toEqual({ type: 'function', function: { name: 'lookup' } })
    expect(choiceOf({ type: 'function' })).toBeUndefined()
    expect(choiceOf('bogus')).toBeUndefined()
    expect(responsesToOpenAiRequest({ input: 'hi' }, 'm')).not.toHaveProperty('tool_choice')

    const jsonObject = responsesToOpenAiRequest({ input: 'hi', text: { format: { type: 'json_object' } } }, 'm')
    expect(jsonObject.response_format).toEqual({ type: 'json_object' })
  })

  it('tolerates malformed input items without throwing', () => {
    const result = responsesToOpenAiRequest({
      input: [
        null,
        42,
        { type: 'function_call' },
        'ok',
        { role: '' },
        { role: 'user', content: [] },
        { role: 'user', content: [{ type: 'input_audio', input_audio: {} }] },
      ],
      tools: 'nope',
      text: { format: { type: 'json_schema' } },
    }, 'model')

    expect(result).toEqual({ model: 'model', messages: [{ role: 'user', content: 'ok' }] })
  })
})
