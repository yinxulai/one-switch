import { describe, expect, it } from 'vitest'
import type { RequestLogEntry, RequestLogEntryAttempt } from '@common/schemas'
import { calculateProviderModelMetrics, providerModelMetricKey } from './model-metrics'

function attempt(overrides: Partial<RequestLogEntryAttempt> = {}): RequestLogEntryAttempt {
  return {
    id: 'att_test',
    attemptIndex: 0,
    status: 'success',
    providerId: 'prov_primary',
    providerName: 'Primary',
    providerModelId: 'model-a',
    providerModelName: 'model-a',
    upstreamProtocol: 'openai-responses',
    upstreamRequestId: null,
    url: 'https://example.com/v1/responses',
    httpStatus: 200,
    retryable: false,
    errorCode: null,
    errorMessage: null,
    durationMilliseconds: 2_000,
    upstreamTransport: 'http',
    ttftMilliseconds: 500,
    requestRewriteRuleIds: [],
    responseRewriteRuleIds: [],
    createdTime: 1,
    ...overrides,
  }
}

function log(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return {
    id: 'req_test',
    logicalModelId: 'model_default',
    clientProtocol: 'openai-responses',
    transport: 'http',
    status: 'success',
    totalDurationMilliseconds: 2_500,
    totalTokens: 120,
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: null,
    cachedInputTokens: null,
    cacheCreationInputTokens: null,
    promptCacheHit: null,
    rawUsage: null,
    ttftMilliseconds: null,
    createdTime: 1,
    attempts: [attempt()],
    ...overrides,
  }
}

describe('calculateProviderModelMetrics', () => {
  it('attributes metrics to the successful failover target and uses total duration for TPS', () => {
    // 首个尝试先拿到过首字然后又失败：它的 100ms 不能算到最终生效的 model-b 头上。
    const metrics = calculateProviderModelMetrics([log({
      attempts: [
        attempt({ status: 'failed', providerId: 'prov_primary', providerModelId: 'model-a', ttftMilliseconds: 100 }),
        attempt({ attemptIndex: 1, providerId: 'prov_backup', providerName: 'Backup', providerModelId: 'model-b', providerModelName: 'model-b' }),
      ],
    })])

    expect(metrics[providerModelMetricKey('prov_backup', 'model-b')]).toEqual({
      sampleCount: 1,
      avgTps: 10,
      avgTtftMilliseconds: 500,
    })
  })

  it('averages only requests that contain each performance metric', () => {
    const metrics = calculateProviderModelMetrics([
      log({ id: 'req_complete' }),
      log({
        id: 'req_missing',
        outputTokens: null,
        totalDurationMilliseconds: 1_000,
        attempts: [attempt({ ttftMilliseconds: null })],
      }),
    ])

    expect(metrics[providerModelMetricKey('prov_primary', 'model-a')]).toEqual({
      sampleCount: 2,
      avgTps: 10,
      avgTtftMilliseconds: 500,
    })
  })
})
