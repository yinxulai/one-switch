import { describe, expect, it } from 'vitest'
import {
  createOpenAiToResponsesState,
  finishOpenAiToResponses,
  openAiChunkToResponsesEvents,
  openAiResponseToResponses,
} from './response-conversion-openai-to-responses'

describe('openAiResponseToResponses', () => {
  it('converts text and cache usage to a completed response', () => {
    const result = openAiResponseToResponses({
      id: 'chat_1',
      model: 'gpt',
      created: 1_700_000_000,
      choices: [{ message: { content: 'Hello' } }],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 2,
        prompt_tokens_details: { cached_tokens: 3 },
      },
    })

    expect(result).toEqual({
      id: 'chat_1',
      object: 'response',
      created_at: 1_700_000_000,
      status: 'completed',
      model: 'gpt',
      output: [{
        id: 'chat_1_msg',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello', annotations: [] }],
      }],
      usage: {
        input_tokens: 8,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens: 2,
        total_tokens: 10,
      },
    })
  })

  it('emits function_call output items for tool calls', () => {
    const result = openAiResponseToResponses({
      id: 'chat_2',
      model: 'gpt',
      choices: [{
        message: {
          content: null,
          tool_calls: [
            { id: 'call_1', function: { name: 'lookup', arguments: '{"q":"x"}' } },
            { id: 'call_2', function: { name: 'store', arguments: '{"v":1}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
    })

    expect(result.output).toEqual([
      { id: 'chat_2_fc_0', type: 'function_call', status: 'completed', call_id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' },
      { id: 'chat_2_fc_1', type: 'function_call', status: 'completed', call_id: 'call_2', name: 'store', arguments: '{"v":1}' },
    ])
  })

  it('returns an empty output for missing choices', () => {
    const result = openAiResponseToResponses({})
    expect(result).toMatchObject({
      id: '',
      object: 'response',
      status: 'completed',
      model: '',
      output: [],
    })
    expect(result.created_at).toBeTypeOf('number')
    expect(result.usage).toBeUndefined()
  })

  it('maps reasoning token details into output_tokens_details', () => {
    const result = openAiResponseToResponses({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 5, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 4 } },
    })
    expect(result.usage).toEqual({
      input_tokens: 5,
      output_tokens: 9,
      output_tokens_details: { reasoning_tokens: 4 },
      total_tokens: 14,
    })
  })
})

describe('openAiChunkToResponsesEvents', () => {
  it('emits the full Responses event lifecycle for a text stream', () => {
    const streamState = createOpenAiToResponsesState()
    const events: Array<Record<string, unknown>> = []
    events.push(...openAiChunkToResponsesEvents({ id: 'chat_1', model: 'gpt', created: 1_700_000_000, choices: [{ delta: { content: 'He' } }] }, streamState))
    events.push(...openAiChunkToResponsesEvents({ choices: [{ delta: { content: 'llo' } }] }, streamState))
    events.push(...openAiChunkToResponsesEvents({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    }, streamState))

    expect(events.map(event => event.type)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ])

    expect(events[0].response).toEqual({
      id: 'chat_1',
      object: 'response',
      created_at: 1_700_000_000,
      status: 'in_progress',
      model: 'gpt',
      output: [],
    })
    expect(events[2]).toEqual({
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: 'chat_1_msg', type: 'message', status: 'in_progress', role: 'assistant', content: [] },
    })
    expect(events[6]).toMatchObject({ item_id: 'chat_1_msg', output_index: 0, content_index: 0, text: 'Hello' })
    expect(events[events.length - 1]).toMatchObject({
      response: {
        status: 'completed',
        output: [{
          id: 'chat_1_msg',
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello', annotations: [] }],
        }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      },
    })
    expect(finishOpenAiToResponses(streamState)).toEqual([])
  })

  it('streams function_call items with their own output indexes', () => {
    const streamState = createOpenAiToResponsesState()
    const events = [
      ...openAiChunkToResponsesEvents({ id: 'chat_2', choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'lookup' } }] } }] }, streamState),
      ...openAiChunkToResponsesEvents({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] } }] }, streamState),
      ...openAiChunkToResponsesEvents({
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }, streamState),
    ]

    expect(events.map(event => event.type)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
      'response.output_item.done',
      'response.completed',
    ])
    expect(events[2]).toEqual({
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: 'chat_2_fc_0', type: 'function_call', status: 'in_progress', call_id: 'call_1', name: 'lookup', arguments: '' },
    })
    expect(events[3]).toEqual({ type: 'response.function_call_arguments.delta', item_id: 'chat_2_fc_0', output_index: 0, delta: '{"q":' })
    expect(events[4]).toEqual({ type: 'response.function_call_arguments.done', item_id: 'chat_2_fc_0', output_index: 0, arguments: '{"q":' })
    expect(events[events.length - 1]).toMatchObject({
      response: {
        output: [{ id: 'chat_2_fc_0', type: 'function_call', status: 'completed', call_id: 'call_1', name: 'lookup', arguments: '{"q":' }],
      },
    })
  })

  it('closes the text item before switching to tool items', () => {
    const streamState = createOpenAiToResponsesState()
    openAiChunkToResponsesEvents({ id: 'chat_3', choices: [{ delta: { content: 'text' } }] }, streamState)
    const events = openAiChunkToResponsesEvents({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'lookup', arguments: '{}' } }] } }],
    }, streamState)

    expect(events.map(event => event.type)).toEqual([
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.output_item.added',
      'response.function_call_arguments.delta',
    ])
    expect(events[3]).toMatchObject({ output_index: 1 })
  })

  it('ignores chunks without text, tools, finish reason, or usage', () => {
    const streamState = createOpenAiToResponsesState()
    expect(openAiChunkToResponsesEvents({ choices: [{ delta: { role: 'assistant' } }] }, streamState)).toEqual([])
    expect(finishOpenAiToResponses(streamState)).toEqual([])
  })

  it('completes on flush when the upstream never reports usage', () => {
    const streamState = createOpenAiToResponsesState()
    openAiChunkToResponsesEvents({ id: 'chat_4', choices: [{ delta: { content: 'partial' } }] }, streamState)
    openAiChunkToResponsesEvents({ choices: [{ delta: {}, finish_reason: 'length' }] }, streamState)

    const tail = finishOpenAiToResponses(streamState)
    expect(tail.map(event => event.type)).toEqual(['response.completed'])
    expect(tail[0]).toMatchObject({ response: { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'partial' }] }] } })
    expect(finishOpenAiToResponses(streamState)).toEqual([])
  })
})
