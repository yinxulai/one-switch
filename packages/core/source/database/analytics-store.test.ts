import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDatabase, getDb, initDatabase } from './index'
import { TEST_DATABASE_FILE_NAME } from './test-support'
import { createRequestAttempt, createRequestLog } from './request-log-store'
import { requestAttempts, requestLogs } from './schema'
import { formatLatencyBucketRange, getLatencyDistribution, getModelStats } from './analytics-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-analytics-store-'))
  await initDatabase(temporaryDirectory, TEST_DATABASE_FILE_NAME)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

// TTFT 是「一次上游尝试」的事实，所以样本必须落在 request_attempts 上。
async function createLog(totalDurationMilliseconds = 1): Promise<string> {
  const log = await createRequestLog({
    logicalModelId: 'model_default',
    clientProtocol: 'openai-responses',
    transport: 'http',
    status: 'success',
    totalDurationMilliseconds,
  })
  return log.id
}

/** 构造一条带 TTFT 的尝试记录——TTFT 是尝试级事实，因此必须落在尝试行上。 */
type AttemptWithTtftInput = {
  requestId: string
  ttftMilliseconds: number
  providerId?: string
  attemptIndex?: number
}

async function createAttemptWithTtft(input: AttemptWithTtftInput): Promise<void> {
  await createRequestAttempt({
    requestId: input.requestId,
    providerId: input.providerId ?? 'prov_latency',
    providerModelId: 'model_default',
    providerName: 'latency-provider',
    providerModelName: 'model_default',
    upstreamProtocol: 'openai-responses',
    upstreamRequestId: null,
    url: 'https://example.com/v1/responses',
    status: 'success',
    httpStatus: 200,
    retryable: false,
    upstreamTransport: 'http',
    attemptIndex: input.attemptIndex ?? 0,
    durationMilliseconds: 1,
    ttftMilliseconds: input.ttftMilliseconds,
  })
}

async function createLogWithTtft(ttftMilliseconds: number, totalDurationMilliseconds = 1): Promise<void> {
  await createAttemptWithTtft({ requestId: await createLog(totalDurationMilliseconds), ttftMilliseconds })
}

describe('formatLatencyBucketRange', () => {
  it('labels every semantic bucket with a stable, non-overlapping range', () => {
    expect(formatLatencyBucketRange(0)).toBe('< 50ms')
    expect(formatLatencyBucketRange(1)).toBe('50ms-100ms')
    expect(formatLatencyBucketRange(2)).toBe('100ms-200ms')
    expect(formatLatencyBucketRange(3)).toBe('200ms-500ms')
    expect(formatLatencyBucketRange(4)).toBe('500ms-1s')
    expect(formatLatencyBucketRange(5)).toBe('1s-2s')
    expect(formatLatencyBucketRange(6)).toBe('2s-5s')
    expect(formatLatencyBucketRange(7)).toBe('>= 5s')
  })
})

describe('getLatencyDistribution', () => {
  it('groups near-neighbour TTFT samples into a single bucket', async () => {
    // 100ms 与 120ms 在感知上同属「首字很快」，不应被拆成两个桶。
    await createLogWithTtft(100)
    await createLogWithTtft(120)

    expect(await getLatencyDistribution(0)).toEqual([{ range: '100ms-200ms', count: 2 }])
  })

  it('assigns samples sitting exactly on an edge to the higher bucket', async () => {
    for (const ttft of [49, 50, 99, 100, 199, 200, 5000]) {
      await createLogWithTtft(ttft)
    }

    expect(await getLatencyDistribution(0)).toEqual([
      { range: '< 50ms', count: 1 },
      { range: '50ms-100ms', count: 2 },
      { range: '100ms-200ms', count: 2 },
      { range: '200ms-500ms', count: 1 },
      { range: '>= 5s', count: 1 },
    ])
  })

  it('buckets by TTFT rather than by total duration', async () => {
    // 总耗时 8s 但首字很快：必须落在 TTFT 的早档，而不是「>= 5s」。
    await createLogWithTtft(120, 8_000)

    const buckets = await getLatencyDistribution(0)
    expect(buckets).toEqual([{ range: '100ms-200ms', count: 1 }])
    expect(buckets.map(bucket => bucket.range)).not.toContain('>= 5s')
  })

  it('returns an empty distribution when no request carries a TTFT sample', async () => {
    await createRequestLog({
      logicalModelId: 'model_default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 10,
    })

    expect(await getLatencyDistribution(0)).toEqual([])
  })

  it('excludes samples created before the requested time window', async () => {
    await createLogWithTtft(120)
    await createLogWithTtft(120)
    const staleId = getDb().select({ id: requestLogs.id }).from(requestLogs).all()[0].id
    getDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(100, staleId)

    expect(await getLatencyDistribution(1_000)).toEqual([{ range: '100ms-200ms', count: 1 }])
  })

  it('attributes each TTFT sample to the provider that actually produced it', async () => {
    // 一次转移请求尝试过两个提供方，样本必须各归各家，而不是同时计入两家。
    const requestId = await createLog()
    await createAttemptWithTtft({ requestId, ttftMilliseconds: 120, providerId: 'prov_first', attemptIndex: 0 })
    await createAttemptWithTtft({ requestId, ttftMilliseconds: 300, providerId: 'prov_second', attemptIndex: 1 })

    expect(await getLatencyDistribution(0, 'prov_first')).toEqual([{ range: '100ms-200ms', count: 1 }])
    expect(await getLatencyDistribution(0, 'prov_second')).toEqual([{ range: '200ms-500ms', count: 1 }])
  })
})

describe('getModelStats', () => {
  interface RankedAttemptInput {
    providerId: string
    providerName: string
    status?: 'success' | 'failed'
    durationMilliseconds?: number
  }

  /** 造一条归属确定的尝试，以便控制排行榜里的「同一模型、不同提供方快照」。 */
  async function createRankedAttempt(input: RankedAttemptInput): Promise<string> {
    const requestId = await createLog()
    await createRequestAttempt({
      requestId,
      providerId: input.providerId,
      providerModelId: 'model_ranking',
      providerName: input.providerName,
      providerModelName: 'ranking-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      status: input.status ?? 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      durationMilliseconds: input.durationMilliseconds ?? 10,
    })
    return requestId
  }

  it('keeps one row per upstream model even when older attempts carry a stale provider snapshot', async () => {
    // 一个 providerModelId 只属于一个提供方：旧快照代表的是同一个模型的不同时期，
    // 而不是排行榜上的两个模型（否则同一个模型会占掉两个 TOP 名额）。
    await createRankedAttempt({ providerId: 'prov_stale', providerName: '旧提供方' })
    await createRankedAttempt({ providerId: 'prov_current', providerName: '现提供方' })

    const stats = await getModelStats(0)
    expect(stats).toHaveLength(1)
    expect(stats[0]).toMatchObject({ providerModelId: 'model_ranking', attempts: 2 })
  })

  it('describes the model with the provider snapshot of its latest attempt', async () => {
    // 模型名与提供方必须来自同一条记录：不能出现「A 家的 id 配 B 家的名字」。
    await createRankedAttempt({ providerId: 'prov_current', providerName: '现提供方' })
    const staleRequestId = await createRankedAttempt({ providerId: 'prov_stale', providerName: '旧提供方' })
    const staleAttemptId = getDb().select({ id: requestAttempts.id }).from(requestAttempts).where(eq(requestAttempts.requestId, staleRequestId)).all()[0].id
    getDb().$client.prepare('UPDATE request_attempts SET createdTime = ? WHERE id = ?').run(1, staleAttemptId)

    expect(await getModelStats(0)).toEqual([
      expect.objectContaining({ providerId: 'prov_current', providerName: '现提供方', providerModelName: 'ranking-model', attempts: 2 }),
    ])
  })

  it('orders the ranking deterministically when attempt counts tie', async () => {
    await createRankedAttempt({ providerId: 'prov_a', providerName: 'A' })
    const otherRequestId = await createLog()
    await createRequestAttempt({
      requestId: otherRequestId,
      providerId: 'prov_b',
      providerModelId: 'model_ranking_b',
      providerName: 'B',
      providerModelName: 'ranking-model-b',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      status: 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      durationMilliseconds: 10,
    })

    const first = await getModelStats(0)
    const second = await getModelStats(0)
    expect(first.map(stat => stat.providerModelId)).toEqual(['model_ranking', 'model_ranking_b'])
    expect(second.map(stat => stat.providerModelId)).toEqual(first.map(stat => stat.providerModelId))
  })
})
