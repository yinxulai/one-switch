import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { TEST_DATABASE_FILE_NAME } from '../database/test-support'
import { createRequestLog, createRequestAttempt, recordAttemptUsage } from '@server/database/request-log-store'
import { createProvider } from '@server/database/provider-store'
import { analyticsRoutes } from './routes/observability/analytics'
import { mockResponse } from './test-support'

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

/** 同一请求的同一次序号只能落一行，冲突时 store 返回 `null`。 */
async function createAttemptOrThrow(input: Parameters<typeof createRequestAttempt>[0]) {
  const attempt = await createRequestAttempt(input)
  if (!attempt) throw new Error('expected attempt to be created')
  return attempt
}

/** 用量字段的「都不知道」形状，用于只关心部分字段的用例。 */
const EMPTY_USAGE = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null }

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-analytics-'))
  await initDatabase(temporaryDirectory, TEST_DATABASE_FILE_NAME)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('analytics route', () => {
  it('uses the default range and returns zero percentages when there is no data', async () => {
    const res = mockResponse()

    await analyticsRoutes.invoke('/api/analytics/summary', res, {})

    const payload = responseData(res) as {
      success: boolean
      data: {
        providerStats: Array<{ percent: number }>
        latencyDistribution: Array<{ count: number; percent: number }>
        failureReasons: Array<{ percent: number }>
      }
    }

    expect(payload.success).toBe(true)
    expect(payload.data.providerStats).toEqual([])
    expect(payload.data.latencyDistribution).toEqual([])
    expect(payload.data.failureReasons).toEqual([])
  })

  it('rejects an unsupported analytics range', async () => {
    const res = mockResponse()

    await expect(analyticsRoutes.invoke('/api/analytics/summary', res, { range: '90d' })).rejects.toThrow()
    expect(res.end).not.toHaveBeenCalled()
  })

  it('returns summary, trend, provider stats and failure reasons for a time range', async () => {
    const provider = await createProvider({ name: 'Analytics Provider', apiKeyReference: 'key_analytics', timeoutMilliseconds: 30_000, enabled: true })
    const successLog = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 1500,
    })
    const failedLog = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'failed',
      totalDurationMilliseconds: 2200,
    })

    const successAttempt = await createAttemptOrThrow({
      requestId: successLog.id,
      providerId: provider.id,
      providerModelId: 'model_success',
      providerName: provider.name,
      providerModelName: 'provider-success',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: 'upstream_success',
      url: 'https://example.com/success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 1500,
      ttftMilliseconds: 150,
      errorCode: null,
      errorMessage: null,
    })
    const failedAttempt = await createAttemptOrThrow({
      requestId: failedLog.id,
      providerId: provider.id,
      providerModelId: 'model_failed',
      providerName: provider.name,
      providerModelName: 'provider-failed',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: 'upstream_failed',
      url: 'https://example.com/failed',
      httpStatus: 429,
      retryable: true,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'failed',
      durationMilliseconds: 2200,
      ttftMilliseconds: 150,
      errorCode: 'RateLimit_429',
      errorMessage: 'rate limited',
    })
    // 服务该请求的尝试把用量镜像到请求级；失败的尝试只在尝试级留下自己的数字。
    await recordAttemptUsage({ attemptId: successAttempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, cacheCreationInputTokens: 0 })
    await recordAttemptUsage({ attemptId: failedAttempt.id, servesRequest: false, ...EMPTY_USAGE, inputTokens: 30, outputTokens: 10, cachedInputTokens: 0, cacheCreationInputTokens: 0 })

    const res = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', res, { range: '7d' })

    const payload = responseData(res) as {
      success: boolean
      data: {
        summary: { totalRequests: number; failedCount: number }
        providerStats: Array<{ providerId: string; percent: number }>
        modelStats: Array<{ providerModelName: string; successRate: number }>
        failureReasons: Array<{ reason: string; count: number }>
      }
    }

    expect(payload.success).toBe(true)
    expect(payload.data.summary.totalRequests).toBeGreaterThanOrEqual(2)
    expect(payload.data.summary.failedCount).toBeGreaterThanOrEqual(1)
    expect(payload.data.providerStats).toEqual(expect.arrayContaining([expect.objectContaining({ providerId: provider.id })]))
    expect(payload.data.modelStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelName: 'provider-success' }),
      expect.objectContaining({ providerModelName: 'provider-failed' }),
    ]))
    expect(payload.data.failureReasons).toEqual(expect.arrayContaining([expect.objectContaining({ reason: '限流 (429)' })]))

    const detailRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/provider-detail', detailRes, { providerId: provider.id, range: '7d' })
    const detailPayload = responseData(detailRes) as {
      success: boolean
      data: {
        summary: { attempts: number; success: number; failed: number; totalTokens: number }
        requestTrend: Array<{ success: number; failed: number; avgLatencyMs: number }>
        tokenTrend: Array<{ inputTokens: number; outputTokens: number }>
        models: Array<{ providerModelName: string }>
        latencyDistribution: Array<{ range: string; count: number; percent: number }>
        failureReasons: Array<{ reason: string; count: number; percent: number }>
      }
    }
    expect(detailPayload.success).toBe(true)
    expect(detailPayload.data.summary).toEqual(expect.objectContaining({ attempts: 2, success: 1, failed: 1, totalTokens: 160 }))
    expect(detailPayload.data.requestTrend.reduce((total, point) => total + point.success + point.failed, 0)).toBe(2)
    expect(detailPayload.data.tokenTrend.reduce((total, point) => total + point.inputTokens + point.outputTokens, 0)).toBe(160)
    // 首字分布只统计成功的尝试，与 avgLatencyMs / avgTtftMs 同一口径。
    expect(detailPayload.data.latencyDistribution).toEqual([expect.objectContaining({ count: 1, percent: 100 })])
    expect(detailPayload.data.failureReasons).toEqual([expect.objectContaining({ reason: '限流 (429)', count: 1, percent: 100 })])
    expect(detailPayload.data.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerModelName: 'provider-success' }),
      expect.objectContaining({ providerModelName: 'provider-failed' }),
    ]))
  })

  it('returns 15-minute intraday trend for the today range', async () => {
    const provider = await createProvider({ name: 'Intraday Provider', apiKeyReference: 'key_intraday', timeoutMilliseconds: 30_000, enabled: true })
    const log = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 1500,
    })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_intraday',
      providerName: provider.name,
      providerModelName: 'intraday-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/intraday',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 1500,
    })
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, cacheCreationInputTokens: 0 })

    const res = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', res, { range: 'today' })

    const payload = responseData(res) as { data: { trend: Array<{ label: string; inputTokens: number }> }; success: boolean }

    expect(payload.success).toBe(true)
    expect(payload.data.trend.length).toBeGreaterThanOrEqual(1)
    expect(payload.data.trend.length).toBeLessThanOrEqual(96)
    expect(payload.data.trend[0].label).toMatch(/^\d{2}:\d{2}$/)
    expect(payload.data.trend.every(point => ['00', '15', '30', '45'].includes(point.label.slice(-2)))).toBe(true)
    expect(payload.data.trend.reduce((total, point) => total + point.inputTokens, 0)).toBe(100)
  })

  it('attributes retries and usage to each provider attempt', async () => {
    const firstProvider = await createProvider({ name: 'First Provider', apiKeyReference: 'key_first', timeoutMilliseconds: 30_000, enabled: true })
    const secondProvider = await createProvider({ name: 'Second Provider', apiKeyReference: 'key_second', timeoutMilliseconds: 30_000, enabled: true })
    const log = await createRequestLog({
      logicalModelId: 'default', clientProtocol: 'openai-responses', transport: 'http', status: 'success',
      totalDurationMilliseconds: 30,
    })
    const failedAttempt = await createAttemptOrThrow({
      requestId: log.id, providerId: firstProvider.id, providerModelId: 'model_first', providerName: firstProvider.name,
      providerModelName: 'first-model', upstreamProtocol: 'openai-responses', upstreamRequestId: null,
      url: 'https://first.example.com', httpStatus: 503, retryable: true, upstreamTransport: 'http', attemptIndex: 0, status: 'failed',
      durationMilliseconds: 10, ttftMilliseconds: 10, errorCode: 'Status_503', errorMessage: 'unavailable',
    })
    const successAttempt = await createAttemptOrThrow({
      requestId: log.id, providerId: secondProvider.id, providerModelId: 'model_second', providerName: secondProvider.name,
      providerModelName: 'second-model', upstreamProtocol: 'openai-responses', upstreamRequestId: null,
      url: 'https://second.example.com', httpStatus: 200, retryable: false, upstreamTransport: 'http', attemptIndex: 1, status: 'success',
      durationMilliseconds: 20, ttftMilliseconds: 10, errorCode: null, errorMessage: null,
    })
    await recordAttemptUsage({ attemptId: failedAttempt.id, servesRequest: false, ...EMPTY_USAGE })
    await recordAttemptUsage({ attemptId: successAttempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, cacheCreationInputTokens: 0 })

    const summaryRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', summaryRes, { range: '7d' })
    const summary = responseData(summaryRes) as { data: { providerStats: Array<{ providerId: string; attempts: number; percent: number }> } }
    expect(summary.data.providerStats).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: firstProvider.id, attempts: 1, percent: 50 }),
      expect.objectContaining({ providerId: secondProvider.id, attempts: 1, percent: 50 }),
    ]))

    const firstDetailRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/provider-detail', firstDetailRes, { providerId: firstProvider.id, range: '7d' })
    const firstDetail = responseData(firstDetailRes) as { data: { summary: { attempts: number; success: number; failed: number; avgLatencyMs: number; totalTokens: number }; models: Array<{ providerModelId: string; success: number; avgLatencyMs: number }>; latencyDistribution: Array<{ count: number }>; failureReasons: Array<{ reason: string }> } }
    expect(firstDetail.data.summary).toEqual(expect.objectContaining({ attempts: 1, success: 0, failed: 1, avgLatencyMs: 0, totalTokens: 0 }))
    expect(firstDetail.data.models).toEqual([expect.objectContaining({ providerModelId: 'model_first', success: 0, avgLatencyMs: 0 })])
    expect(firstDetail.data.latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)).toBe(1)
    expect(firstDetail.data.failureReasons).toEqual([])

    const secondDetailRes = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/provider-detail', secondDetailRes, { providerId: secondProvider.id, range: '7d' })
    const secondDetail = responseData(secondDetailRes) as { data: { summary: { attempts: number; success: number; totalTokens: number }; models: Array<{ providerModelId: string }>; latencyDistribution: Array<{ count: number }>; failureReasons: Array<{ reason: string }> } }
    expect(secondDetail.data.summary).toEqual(expect.objectContaining({ attempts: 1, success: 1, totalTokens: 12 }))
    expect(secondDetail.data.models).toEqual([expect.objectContaining({ providerModelId: 'model_second' })])
    expect(secondDetail.data.latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)).toBe(1)
    expect(secondDetail.data.failureReasons).toEqual([])
  })

  it('rejects provider detail when the provider has no data in range', async () => {
    const res = mockResponse()

    await analyticsRoutes.invoke('/api/analytics/provider-detail', res, { providerId: 'prov_missing', range: '7d' })

    const payload = responseData(res) as { success: boolean; errorCode: string }
    expect(payload.success).toBe(false)
    expect(payload.errorCode).toBe('RESOURCE_NOT_FOUND')
    expect(res.statusCode).toBe(404)
  })

  it('buckets latency distribution by TTFT instead of total duration', async () => {
    const provider = await createProvider({ name: 'TTFT Provider', apiKeyReference: 'key_ttft', timeoutMilliseconds: 30_000, enabled: true })
    const shortTtftLongDuration = await createRequestLog({
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 8_000,
    })
    await createAttemptOrThrow({
      requestId: shortTtftLongDuration.id,
      providerId: provider.id,
      providerModelId: 'model_ttft',
      providerName: provider.name,
      providerModelName: 'ttft-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: 'upstream_ttft',
      url: 'https://example.com/ttft',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 8_000,
      ttftMilliseconds: 120,
    })

    const res = mockResponse()
    await analyticsRoutes.invoke('/api/analytics/summary', res, { range: '7d' })

    const payload = responseData(res) as { data: { latencyDistribution: Array<{ range: string; count: number }> }; success: boolean }

    expect(payload.success).toBe(true)
    // 120ms 的 TTFT 必须落在「100ms-200ms」；如果按 8s 总耗时分桶会落到「>= 5s」。
    expect(payload.data.latencyDistribution).toEqual([
      expect.objectContaining({ range: '100ms-200ms', count: 1 }),
    ])
  })
})
