import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelWithProvider } from './router'

const mocks = vi.hoisted(() => ({
  initializeRequestLogger: vi.fn(),
  createAttemptLogger: vi.fn(),
  getSettings: vi.fn(async () => ({ captureRequestContent: true })),
}))

vi.mock('./logging', () => ({
  initializeRequestLogger: mocks.initializeRequestLogger,
  createAttemptLogger: mocks.createAttemptLogger,
}))

vi.mock('../database/settings-store', () => ({ getSettings: mocks.getSettings }))

import { WebSocketTurnObserver } from './websocket-turn-observer'

const target = {
  provider: { id: 'prov_test', name: 'Test Provider' },
  model: { id: 'pm_test', providerId: 'prov_test', modelName: 'provider-name' },
} as ModelWithProvider

function createLoggerMocks() {
  const logger = {
    requestContentId: 'content_request',
    finalizeRequestLog: vi.fn(async () => undefined),
    finalizeRequestContent: vi.fn(async () => undefined),
    finalizeLocalErrorContent: vi.fn(async () => undefined),
    recordAttempt: vi.fn(async () => ({ id: 'attempt_test' })),
    recordAttemptContent: vi.fn(async () => undefined),
  }
  const attemptLogger = {
    recordAttempt: logger.recordAttempt,
    recordAttemptContent: logger.recordAttemptContent,
  }
  mocks.initializeRequestLogger.mockResolvedValueOnce(logger)
  mocks.createAttemptLogger.mockReturnValueOnce(attemptLogger)
  return { logger, attemptLogger }
}

function createObserver() {
  return new WebSocketTurnObserver({
    logicalModelId: 'default',
    protocol: 'openai-responses',
    path: '/v1/responses',
    requestHeaders: {},
    upstreamUrl: 'wss://provider.example/v1/responses',
    target,
  })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('WebSocketTurnObserver', () => {
  it('creates a turn and finalizes it with usage and TTFT', async () => {
    const { logger, attemptLogger } = createLoggerMocks()
    const observer = createObserver()

    await observer.start('{"type":"response.create","model":"pm_test"}', 'stream_1')
    await observer.observe({
      type: 'event',
      correlationKey: 'stream_1',
      hasOutput: true,
      usage: { inputTokens: 2, outputTokens: null, reasoningTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, rawUsage: null },
    }, '{"type":"response.output_text.delta"}')
    await observer.observe({
      type: 'complete',
      correlationKey: 'stream_1',
      usage: { inputTokens: null, outputTokens: 3, reasoningTokens: 1, cachedInputTokens: null, cacheCreationInputTokens: null, rawUsage: null },
    }, '{"type":"response.completed"}')

    expect(mocks.getSettings).toHaveBeenCalledTimes(1)
    expect(mocks.initializeRequestLogger).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.stringMatching(/^req_/), logicalModelId: 'default', clientProtocol: 'openai-responses', method: 'WEBSOCKET', path: '/v1/responses', requestBody: Buffer.from('{"type":"response.create","model":"pm_test"}'), captureRequestContent: true }))
    expect(mocks.createAttemptLogger).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.stringMatching(/^req_/), attemptIndex: 0, snapshot: expect.objectContaining({ providerModelId: 'pm_test', providerModelName: 'provider-name' }), clientProtocol: 'openai-responses', upstreamProtocol: 'openai-responses', requiresResponseConversion: false }))
    expect(attemptLogger.recordAttempt).toHaveBeenCalledWith('success', 101, false, undefined, undefined, undefined, undefined, expect.objectContaining({ inputTokens: 2, outputTokens: 3, reasoningTokens: 1 }))
    expect(logger.recordAttemptContent).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'attempt_test', captureStatus: 'captured', responseStatus: 101, responseBody: expect.stringContaining('response.completed') }))
    expect(logger.finalizeRequestContent).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 101, captureStatus: 'captured', responseStatus: 101, responseBody: expect.stringContaining('response.output_text.delta') }))
    expect(logger.finalizeRequestLog).toHaveBeenCalledWith('success', expect.any(Number), expect.objectContaining({ inputTokens: 2, outputTokens: 3, ttftMilliseconds: expect.any(Number), upstreamProtocol: 'openai-responses' }))
  })

  it('records failed turns with the protocol error and partial content', async () => {
    const { logger, attemptLogger } = createLoggerMocks()
    const observer = createObserver()
    await observer.start('{"type":"response.create"}', 'stream_failed')
    await observer.observe({ type: 'failed', correlationKey: 'stream_failed', error: 'upstream failure' }, '{"type":"error"}')

    expect(attemptLogger.recordAttempt).toHaveBeenCalledWith('failed', null, false, 'WS_RESPONSE_FAILED', 'upstream failure', undefined, undefined, expect.anything())
    expect(logger.recordAttemptContent).toHaveBeenCalledWith(expect.objectContaining({ captureStatus: 'partial', responseStatus: null, responseBody: expect.stringContaining('error') }))
    expect(logger.finalizeRequestContent).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 502, captureStatus: 'partial' }))
    expect(logger.finalizeRequestLog).toHaveBeenCalledWith('failed', expect.any(Number), expect.objectContaining({ ttftMilliseconds: null }))
  })

  it('ignores observations after completion and observations without a pending turn', async () => {
    const { logger } = createLoggerMocks()
    const observer = createObserver()
    await observer.observe({ type: 'event', hasOutput: true }, '{}')
    expect(logger.finalizeRequestLog).not.toHaveBeenCalled()

    await observer.start('{"type":"response.create"}', 'stream_done')
    await observer.observe({ type: 'complete', correlationKey: 'stream_done' }, '{}')
    await observer.observe({ type: 'event', correlationKey: 'stream_done', hasOutput: true }, '{}')
    expect(logger.finalizeRequestLog).toHaveBeenCalledTimes(1)
  })

  it('caches settings and increments attempt indexes for multiple turns', async () => {
    const first = createLoggerMocks()
    const observer = createObserver()
    await observer.start('{"type":"response.create"}', 'stream_1')
    const second = createLoggerMocks()
    await observer.start('{"type":"response.create"}', 'stream_2')

    expect(mocks.getSettings).toHaveBeenCalledTimes(1)
    expect(mocks.createAttemptLogger).toHaveBeenNthCalledWith(1, expect.objectContaining({ attemptIndex: 0 }))
    expect(mocks.createAttemptLogger).toHaveBeenNthCalledWith(2, expect.objectContaining({ attemptIndex: 1 }))
    expect(first.logger.finalizeRequestLog).not.toHaveBeenCalled()
    expect(second.logger.finalizeRequestLog).not.toHaveBeenCalled()
  })

  it('routes correlated observations to the matching turn and finishes all pending turns', async () => {
    const first = createLoggerMocks()
    const observer = createObserver()
    await observer.start('{"type":"response.create"}', 'stream_1')
    const second = createLoggerMocks()
    await observer.start('{"type":"response.create"}', 'stream_2')

    await observer.observe({ type: 'complete', correlationKey: 'stream_2' }, '{"type":"response.completed","stream_id":"stream_2"}')
    expect(second.logger.finalizeRequestLog).toHaveBeenCalledWith('success', expect.any(Number), expect.anything())
    expect(first.logger.finalizeRequestLog).not.toHaveBeenCalled()

    await observer.finishAll('cancelled', 'connection closed')
    expect(first.logger.finalizeRequestLog).toHaveBeenCalledWith('cancelled', expect.any(Number), expect.objectContaining({ upstreamProtocol: 'openai-responses' }))
  })

  it('does not finalize a turn more than once', async () => {
    const { logger } = createLoggerMocks()
    const observer = createObserver()
    await observer.start('{"type":"response.create"}', 'stream_1')

    const completion = { type: 'complete' as const, correlationKey: 'stream_1' }
    await Promise.all([observer.observe(completion, '{}'), observer.observe(completion, '{}')])

    expect(logger.finalizeRequestLog).toHaveBeenCalledTimes(1)
  })
})
