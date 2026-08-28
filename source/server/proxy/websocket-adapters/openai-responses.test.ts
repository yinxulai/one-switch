import { describe, expect, it } from 'vitest'
import { openAIResponsesWebSocketAdapter } from './openai-responses'

describe('OpenAI Responses WebSocket adapter', () => {
  it('matches Responses paths', () => {
    expect(openAIResponsesWebSocketAdapter.matches({} as never, '/v1/responses')).toBe(true)
    expect(openAIResponsesWebSocketAdapter.matches({} as never, '/v1/chat/completions')).toBe(false)
  })

  it('rewrites the provider model id and preserves the official response.create fields', () => {
    const result = openAIResponsesWebSocketAdapter.transformClientFrame(JSON.stringify({
      type: 'response.create',
      model: 'client-model',
      stream_id: 'lane_1',
      previous_response_id: 'resp_previous',
      input: [{ role: 'user', content: 'Hello' }],
    }), 'pm_provider_model')

    expect(result).toEqual({
      ok: true,
      correlationKey: 'lane_1',
      payload: JSON.stringify({
        type: 'response.create',
        model: 'pm_provider_model',
        stream_id: 'lane_1',
        previous_response_id: 'resp_previous',
        input: [{ role: 'user', content: 'Hello' }],
      }),
    })
  })

  it.each([
    ['invalid JSON', '{'],
    ['non-object event', '[]'],
    ['unsupported event', JSON.stringify({ type: 'ping' })],
    ['non-string model', JSON.stringify({ type: 'response.create', model: 42 })],
    ['non-string stream id', JSON.stringify({ type: 'response.create', stream_id: 42 })],
  ])('rejects %s client frames', (_label, raw) => {
    expect(openAIResponsesWebSocketAdapter.transformClientFrame(raw, 'pm_provider_model')).toMatchObject({ ok: false, code: 1002 })
  })

  it('observes official output and completed events with nested usage', () => {
    const delta = openAIResponsesWebSocketAdapter.observeServerFrame(JSON.stringify({
      type: 'response.output_text.delta',
      sequence_number: 3,
      stream_id: 'lane_1',
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
      delta: 'hello',
    }))
    expect(delta).toMatchObject({ type: 'event', hasOutput: true, correlationKey: 'lane_1' })

    const completed = openAIResponsesWebSocketAdapter.observeServerFrame(JSON.stringify({
      type: 'response.completed',
      sequence_number: 10,
      stream_id: 'lane_1',
      response: {
        id: 'resp_1',
        status: 'completed',
        usage: {
          input_tokens: 12,
          input_tokens_details: { cached_tokens: 4 },
          output_tokens: 7,
          output_tokens_details: { reasoning_tokens: 3 },
          total_tokens: 19,
        },
      },
    }))
    expect(completed).toMatchObject({
      type: 'complete',
      correlationKey: 'lane_1',
      usage: { inputTokens: 12, cachedInputTokens: 4, outputTokens: 7, reasoningTokens: 3 },
    })
    expect(completed?.usage?.rawUsage).toMatchObject({ total_tokens: 19 })
  })

  it('uses FIFO routing for default-lane events instead of treating response.id as a lane', () => {
    const completed = openAIResponsesWebSocketAdapter.observeServerFrame(JSON.stringify({
      type: 'response.completed',
      sequence_number: 4,
      response: { id: 'resp_default', status: 'completed', usage: null },
    }))

    expect(completed).toMatchObject({ type: 'complete' })
    expect(completed?.correlationKey).toBeUndefined()
    expect(completed?.usage).toMatchObject({ inputTokens: null, outputTokens: null, rawUsage: null })
  })

  it('treats incomplete responses as terminal and preserves optional final usage', () => {
    const incomplete = openAIResponsesWebSocketAdapter.observeServerFrame(JSON.stringify({
      type: 'response.incomplete',
      sequence_number: 8,
      stream_id: 'lane_incomplete',
      response: {
        id: 'resp_incomplete',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    }))

    expect(incomplete).toMatchObject({
      type: 'complete',
      correlationKey: 'lane_incomplete',
      usage: { inputTokens: 5, outputTokens: 0 },
    })
  })

  it.each([
    ['response.failed', { type: 'response.failed', sequence_number: 5, response: { id: 'resp_failed', status: 'failed', usage: null } }],
    ['error with a named lane', { type: 'error', sequence_number: 6, stream_id: 'lane_error', status: 400, error: { type: 'invalid_request_error', message: 'Invalid input' } }],
    ['error on the default lane', { type: 'error', sequence_number: 7, status: 500, error: { type: 'server_error', message: 'Failed' } }],
  ])('observes %s as a failed turn', (_label, event) => {
    const observation = openAIResponsesWebSocketAdapter.observeServerFrame(JSON.stringify(event))
    expect(observation).toMatchObject({ type: 'failed' })
    expect(observation?.correlationKey).toBe('stream_id' in event ? event.stream_id : undefined)
  })

  it('forwards unknown valid server events without marking them as failures', () => {
    const observation = openAIResponsesWebSocketAdapter.observeServerFrame(JSON.stringify({
      type: 'response.output_item.added',
      sequence_number: 2,
      stream_id: 'lane_1',
      output_index: 0,
      item: { id: 'msg_1', type: 'message' },
    }))

    expect(observation).toMatchObject({ type: 'event', hasOutput: false, correlationKey: 'lane_1' })
  })
})
