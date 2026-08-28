import { describe, expect, it } from 'vitest'
import { openAIResponsesWebSocketAdapter } from './openai-responses'

describe('OpenAI Responses WebSocket adapter', () => {
  it('matches Responses paths', () => {
    expect(openAIResponsesWebSocketAdapter.matches({} as never, '/v1/responses')).toBe(true)
    expect(openAIResponsesWebSocketAdapter.matches({} as never, '/v1/chat/completions')).toBe(false)
  })

  it('rewrites the provider model using its model id', () => {
    const result = openAIResponsesWebSocketAdapter.transformClientFrame(JSON.stringify({ type: 'response.create', model: 'client-model' }), 'pm_provider_model')
    expect(result).toEqual({ ok: true, payload: JSON.stringify({ type: 'response.create', model: 'pm_provider_model' }) })
  })

  it('rejects unsupported client events', () => {
    const result = openAIResponsesWebSocketAdapter.transformClientFrame(JSON.stringify({ type: 'ping' }), 'pm_provider_model')
    expect(result).toMatchObject({ ok: false, code: 1002 })
  })

  it('observes output, usage and completion', () => {
    const delta = openAIResponsesWebSocketAdapter.observeServerFrame(JSON.stringify({ type: 'response.output_text.delta', delta: 'hello' }))
    expect(delta).toMatchObject({ type: 'event', hasOutput: true })
    const completed = openAIResponsesWebSocketAdapter.observeServerFrame(JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', usage: { input_tokens: 2, output_tokens: 3 } } }))
    expect(completed).toMatchObject({ type: 'complete', correlationKey: 'resp_1', usage: { inputTokens: 2, outputTokens: 3 } })
  })
})
