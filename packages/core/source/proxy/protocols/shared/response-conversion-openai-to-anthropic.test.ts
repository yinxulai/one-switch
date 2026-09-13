import { describe, expect, it } from 'vitest'
import {
  createOpenAiToAnthropicState,
  finishOpenAiToAnthropic,
  openAiChunkToAnthropicEvents,
  openAiResponseToAnthropic,
} from './response-conversion-openai-to-anthropic'

describe('openAiResponseToAnthropic', () => {
  it('converts tool calls, malformed arguments, stop reason, and usage', () => {
    const result = openAiResponseToAnthropic({
      id: 'chat_1',
      model: 'gpt',
      choices: [{
        message: {
          content: 'Checking',
          tool_calls: [{ id: 'call_1', function: { name: 'lookup', arguments: '{bad' } }],
        },
        finish_reason: 'content_filter',
      }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
        prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
      },
    })

    expect(result).toEqual({
      id: 'chat_1',
      type: 'message',
      role: 'assistant',
      model: 'gpt',
      content: [
        { type: 'text', text: 'Checking' },
        { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 6, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 },
    })
  })

  it('maps a content filter finish to refusal without tool calls', () => {
    const result = openAiResponseToAnthropic({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] })
    expect(result.stop_reason).toBe('refusal')
  })

  it('joins array-style content parts and tolerates a missing choice', () => {
    const parts = openAiResponseToAnthropic({
      choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, finish_reason: 'stop' }],
    })
    expect(parts.content).toEqual([{ type: 'text', text: 'ab' }])

    const empty = openAiResponseToAnthropic({})
    expect(empty).toMatchObject({ id: '', model: '', content: [], stop_reason: 'end_turn' })
    expect(empty.usage).toBeUndefined()
  })

  it('keeps text before tool_use blocks', () => {
    const result = openAiResponseToAnthropic({
      choices: [{
        message: {
          content: 'thinking out loud',
          tool_calls: [
            { id: 'call_1', function: { name: 'a', arguments: '{"x":1}' } },
            { id: 'call_2', function: { name: 'b', arguments: '{"y":2}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
    })
    expect((result.content as Array<{ type: string }>).map(block => block.type)).toEqual(['text', 'tool_use', 'tool_use'])
  })
})

describe('OpenAI to Anthropic stream conversion', () => {
  it('emits text lifecycle events and completes when usage arrives', () => {
    const streamState = createOpenAiToAnthropicState()
    const textEvents = openAiChunkToAnthropicEvents({
      id: 'chat_1',
      model: 'gpt',
      choices: [{ delta: { content: 'Hello' }, finish_reason: null }],
    }, streamState)
    const finishEvents = openAiChunkToAnthropicEvents({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    }, streamState)

    expect(textEvents.map(event => event.type)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
    ])
    expect(textEvents[1]).toEqual({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    expect(finishEvents).toEqual([
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 2, output_tokens: 1 } },
      { type: 'message_stop' },
    ])
    expect(finishOpenAiToAnthropic(streamState)).toEqual([])
  })

  it('allocates content block indexes that do not collide with tool indexes', () => {
    const streamState = createOpenAiToAnthropicState()
    openAiChunkToAnthropicEvents({ id: 'chat_2', choices: [{ delta: { content: 'Hi' } }] }, streamState)
    const events = [
      ...openAiChunkToAnthropicEvents({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'lookup' } }] } }] }, streamState),
      ...openAiChunkToAnthropicEvents({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"x"}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }, streamState),
    ]

    const toolStart = events.find(event => event.type === 'content_block_start')
    expect(toolStart).toEqual({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} } })
    const delta = events.find(event => event.type === 'content_block_delta') as { index: number }
    expect(delta.index).toBe(1)
    expect(events.filter(event => event.type === 'content_block_stop').map(event => (event as { index: number }).index)).toEqual([0, 1])
    expect(events.at(-1)).toEqual({ type: 'message_stop' })
  })

  it('keeps one Anthropic index per OpenAI tool index across chunks', () => {
    const streamState = createOpenAiToAnthropicState()
    const first = openAiChunkToAnthropicEvents({
      choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_1', function: { name: 'a' } },
        { index: 1, id: 'call_2', function: { name: 'b' } },
      ] } }],
    }, streamState)
    const second = openAiChunkToAnthropicEvents({
      choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{}' } }] } }],
    }, streamState)

    expect(first.filter(event => event.type === 'content_block_start').map(event => (event as { index: number }).index)).toEqual([0, 1])
    expect(second).toEqual([{ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }])
  })

  it('waits for usage before closing and closes on flush otherwise', () => {
    const streamState = createOpenAiToAnthropicState()
    openAiChunkToAnthropicEvents({ id: 'chat_3', choices: [{ delta: { content: 'x' } }] }, streamState)

    expect(openAiChunkToAnthropicEvents({ choices: [{ delta: {}, finish_reason: 'length' }] }, streamState)).toEqual([])

    const tail = finishOpenAiToAnthropic(streamState)
    expect(tail.map(event => event.type)).toEqual(['content_block_stop', 'message_delta', 'message_stop'])
    expect(tail[1]).toEqual({ type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: null } })
  })

  it('flushes a started stream exactly once', () => {
    const streamState = createOpenAiToAnthropicState()
    openAiChunkToAnthropicEvents({ id: 'chat_1', choices: [{ delta: { content: 'partial' } }] }, streamState)

    expect(finishOpenAiToAnthropic(streamState).map(event => event.type)).toEqual([
      'content_block_stop',
      'message_delta',
      'message_stop',
    ])
    expect(finishOpenAiToAnthropic(streamState)).toEqual([])
  })

  it('never flushes a stream that produced no content', () => {
    const streamState = createOpenAiToAnthropicState()
    expect(openAiChunkToAnthropicEvents({ choices: [{ delta: { role: 'assistant' } }] }, streamState)).toEqual([])
    expect(finishOpenAiToAnthropic(streamState)).toEqual([])
  })

  it('emits an empty but valid message when the upstream returns usage only', () => {
    const streamState = createOpenAiToAnthropicState()
    const events = openAiChunkToAnthropicEvents({
      id: 'chat_4',
      model: 'gpt',
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    }, streamState)

    expect(events.map(event => event.type)).toEqual(['message_start', 'message_delta', 'message_stop'])
  })

  it('merges cache usage reported only on the final chunk', () => {
    const streamState = createOpenAiToAnthropicState()
    openAiChunkToAnthropicEvents({ id: 'chat_5', choices: [{ delta: { content: 'hi' } }] }, streamState)
    const events = openAiChunkToAnthropicEvents({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 7, cache_write_tokens: 5 } },
    }, streamState)

    const delta = events.find(event => event.type === 'message_delta') as { usage: unknown }
    expect(delta.usage).toEqual({ input_tokens: 8, output_tokens: 2, cache_read_input_tokens: 7, cache_creation_input_tokens: 5 })
  })
})
