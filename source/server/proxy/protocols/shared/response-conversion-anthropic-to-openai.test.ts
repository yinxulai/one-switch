import { describe, expect, it } from 'vitest'
import {
  anthropicEventToOpenAiChunks,
  anthropicResponseToOpenAi,
  createAnthropicToOpenAiState,
  finishAnthropicToOpenAiChunks,
} from './response-conversion-anthropic-to-openai'

describe('anthropicResponseToOpenAi', () => {
  it('converts text, tool calls, stop reason, and cache usage', () => {
    const result = anthropicResponseToOpenAi({
      id: 'msg_1',
      model: 'claude',
      content: [
        { type: 'text', text: 'Checking' },
        { type: 'tool_use', id: 'call_1', name: 'lookup', input: { id: 1 } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
    })

    expect(result).toMatchObject({
      id: 'msg_1',
      object: 'chat.completion',
      model: 'claude',
      choices: [{
        message: {
          role: 'assistant',
          content: 'Checking',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 4,
        total_tokens: 19,
        prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
      },
    })
  })

  it('maps every Anthropic stop reason to an OpenAI finish reason', () => {
    const finishOf = (stopReason: string): unknown =>
      (anthropicResponseToOpenAi({ content: [], stop_reason: stopReason }).choices as Array<{ finish_reason: string }>)[0].finish_reason

    expect(finishOf('end_turn')).toBe('stop')
    expect(finishOf('max_tokens')).toBe('length')
    expect(finishOf('stop_sequence')).toBe('stop')
    expect(finishOf('refusal')).toBe('content_filter')
    expect(finishOf('something_new')).toBe('stop')
  })

  it('omits usage when the Anthropic response has none', () => {
    const result = anthropicResponseToOpenAi({ id: 'msg_2', content: [{ type: 'text', text: 'hi' }] })
    expect(result.usage).toBeUndefined()
    expect(result.choices).toEqual([{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }])
  })
})

describe('anthropicEventToOpenAiChunks', () => {
  it('tracks message metadata, tool deltas, and merged usage', () => {
    const streamState = createAnthropicToOpenAiState()
    const start = anthropicEventToOpenAiChunks({
      type: 'message_start',
      message: { id: 'msg_1', model: 'claude', usage: { input_tokens: 5 } },
    }, streamState)
    const toolStart = anthropicEventToOpenAiChunks({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call_1', name: 'lookup' },
    }, streamState)
    const toolDelta = anthropicEventToOpenAiChunks({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"id":' },
    }, streamState)
    const finish = anthropicEventToOpenAiChunks({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 2 },
    }, streamState)

    expect(start[0]).toMatchObject({ id: 'msg_1', model: 'claude', choices: [{ delta: { role: 'assistant' }, finish_reason: null }] })
    expect(toolStart[0]).toMatchObject({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'lookup', arguments: '' } }] } }] })
    expect(toolDelta[0]).toMatchObject({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"id":' } }] } }] })
    expect(finish[0]).toMatchObject({
      choices: [{ finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    })
    expect(finishAnthropicToOpenAiChunks(streamState)).toEqual([])
  })

  it('renumbers Anthropic content block indexes into dense OpenAI tool indexes', () => {
    const streamState = createAnthropicToOpenAiState()
    const first = anthropicEventToOpenAiChunks({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }, streamState)
    const second = anthropicEventToOpenAiChunks({
      type: 'content_block_start',
      index: 3,
      content_block: { type: 'tool_use', id: 'call_a', name: 'a' },
    }, streamState)
    const third = anthropicEventToOpenAiChunks({
      type: 'content_block_start',
      index: 7,
      content_block: { type: 'tool_use', id: 'call_b', name: 'b' },
    }, streamState)
    const delta = anthropicEventToOpenAiChunks({
      type: 'content_block_delta',
      index: 7,
      delta: { type: 'input_json_delta', partial_json: '{}' },
    }, streamState)

    expect(first).toEqual([])
    expect(toolIndexOf(second)).toBe(0)
    expect(toolIndexOf(third)).toBe(1)
    expect(delta[0]).toMatchObject({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{}' } }] } }] })
  })

  it('emits a text delta for text_delta blocks and ignores thinking deltas', () => {
    const streamState = createAnthropicToOpenAiState()
    anthropicEventToOpenAiChunks({ type: 'message_start', message: { id: 'msg_3' } }, streamState)

    expect(anthropicEventToOpenAiChunks({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'hello' },
    }, streamState)).toEqual([{
      id: 'msg_3',
      object: 'chat.completion.chunk',
      created: expect.any(Number),
      model: '',
      choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
    }])

    expect(anthropicEventToOpenAiChunks({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'thinking_delta', thinking: 'hmm' },
    }, streamState)).toEqual([])
    expect(anthropicEventToOpenAiChunks({ type: 'content_block_stop', index: 1 }, streamState)).toEqual([])
  })

  it('keeps the same timestamp across every chunk of a stream', () => {
    const streamState = createAnthropicToOpenAiState()
    const first = anthropicEventToOpenAiChunks({ type: 'message_start', message: { id: 'msg_4' } }, streamState)
    const second = anthropicEventToOpenAiChunks({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 1 },
    }, streamState)

    expect(second[0].created).toBe(first[0].created)
  })

  it('closes the stream when message_delta omits stop_reason', () => {
    const streamState = createAnthropicToOpenAiState()
    anthropicEventToOpenAiChunks({ type: 'message_start', message: { id: 'msg_5', usage: { input_tokens: 3 } } }, streamState)

    const mid = anthropicEventToOpenAiChunks({ type: 'message_delta', usage: { output_tokens: 1 } }, streamState)
    expect(mid[0]).toMatchObject({ choices: [{ finish_reason: null }] })
    expect(streamState.stopped).toBe(false)

    const tail = finishAnthropicToOpenAiChunks(streamState)
    expect(tail[0]).toMatchObject({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } })
    expect(finishAnthropicToOpenAiChunks(streamState)).toEqual([])
  })

  it('uses message_stop as a fallback terminator and never flushes a silent stream', () => {
    const streamState = createAnthropicToOpenAiState()
    anthropicEventToOpenAiChunks({ type: 'message_start', message: { id: 'msg_6' } }, streamState)
    const stopped = anthropicEventToOpenAiChunks({ type: 'message_stop' }, streamState)
    expect(stopped[0]).toMatchObject({ choices: [{ finish_reason: 'stop' }] })
    expect(finishAnthropicToOpenAiChunks(streamState)).toEqual([])

    const silent = createAnthropicToOpenAiState()
    expect(anthropicEventToOpenAiChunks({ type: 'ping' }, silent)).toEqual([])
    expect(finishAnthropicToOpenAiChunks(silent)).toEqual([])
  })
})

function toolIndexOf(chunks: Array<Record<string, unknown>>): unknown {
  const choices = chunks[0].choices as Array<{ delta: { tool_calls: Array<{ index: number }> } }>
  return choices[0].delta.tool_calls[0].index
}
