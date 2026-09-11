import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from './index'
import { TEST_DATABASE_FILE_NAME } from './test-support'
import {
  getFailureReasons,
  getIntradayUsageTrend,
  getLatencyDistribution,
  getModelStats,
  getProviderAnalyticsTrend,
  getProviderStats,
  getRequestSourceStats,
  getStatsSummary,
  getUsageTrend,
} from './analytics-store'

const REQUEST_COUNT = 150_000
const PROVIDER_COUNT = 8

let temporaryDirectory: string

function seed(): void {
  const db = getDb().$client
  const time = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  db.exec('BEGIN')
  try {
    const insertLog = db.prepare('INSERT INTO request_logs (id, status, clientProtocol, streaming, logicalModelId, totalDurationMilliseconds, createdTime) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const insertAttempt = db.prepare('INSERT INTO request_attempts (id, requestId, providerId, providerModelId, providerName, providerModelName, upstreamProtocol, upstreamRequestId, url, status, httpStatus, retryable, streaming, attemptIndex, durationMilliseconds, ttftMilliseconds, errorCode, errorMessage, requestRewriteRuleIds, responseRewriteRuleIds, createdTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const insertUsage = db.prepare('INSERT INTO request_usages (requestId, type, value, rawValue, createdTime) VALUES (?, ?, ?, ?, ?)')
    const insertAttemptUsage = db.prepare('INSERT INTO attempt_usages (attemptId, type, value, rawValue, createdTime) VALUES (?, ?, ?, ?, ?)')
    const insertAttribute = db.prepare('INSERT INTO request_attributes (requestId, key, value, createdTime) VALUES (?, ?, ?, ?)')

    for (let index = 0; index < REQUEST_COUNT; index += 1) {
      const requestId = `req_${index}`
      const providerIndex = index % PROVIDER_COUNT
      const providerId = `prov_${providerIndex}`
      const modelId = `model_${providerIndex}_${index % 3}`
      const createdTime = time - (index % 30) * DAY - (index % 86_400_000)
      const failed = index % 17 === 0
      const streamed = index % 3 === 0
      const status = failed ? 'failed' : 'success'
      insertLog.run(requestId, status, streamed ? 'openai-responses' : 'anthropic-messages', streamed ? 1 : 0, `lm_${index % 5}`, 100 + (index % 5000), createdTime)
      const attempts = failed ? 2 : 1
      for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
        const attemptId = `${requestId}_a${attemptIndex}`
        const attemptFailed = failed && attemptIndex === attempts - 1
        insertAttempt.run(
          attemptId, requestId, providerId, modelId, `供应商 ${providerIndex}`, `model_${index % 3}`,
          'openai-responses', `up_${index}`, 'https://example.com/v1/responses',
          attemptFailed ? 'failed' : 'success', attemptFailed ? 500 : 200, 0, streamed ? 1 : 0,
          attemptIndex, 100 + (index % 5000), 20 + (index % 900), attemptFailed ? 'UPSTREAM_ERROR' : null, null, '[]', '[]', createdTime,
        )
        insertAttemptUsage.run(attemptId, 'inputTokens', 100 + (index % 1000), null, createdTime)
        insertAttemptUsage.run(attemptId, 'outputTokens', 50 + (index % 500), null, createdTime)
      }
      insertUsage.run(requestId, 'inputTokens', 100 + (index % 1000), null, createdTime)
      insertUsage.run(requestId, 'outputTokens', 50 + (index % 500), null, createdTime)
      insertUsage.run(requestId, 'raw', null, '{"input_tokens":1}', createdTime)
      insertAttribute.run(requestId, 'request.source', `source-${index % 6}`, createdTime)
      insertAttribute.run(requestId, 'client.category', `category-${index % 4}`, createdTime)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const PROBE_LOG = path.join(process.cwd(), 'probe-output.log')

function logProbe(line: string): void {
  fs.appendFileSync(PROBE_LOG, `${line}\n`)
}

async function time(label: string, run: () => unknown | Promise<unknown>): Promise<void> {
  const startedAt = performance.now()
  await run()
  const duration = performance.now() - startedAt
  logProbe(`PROBE ${label} ${duration.toFixed(1)}ms`)
}

async function timeMany(label: string, runs: Array<() => unknown | Promise<unknown>>): Promise<void> {
  const startedAt = performance.now()
  for (const run of runs) await run()
  const duration = performance.now() - startedAt
  logProbe(`PROBE ${label} ${duration.toFixed(1)}ms`)
}

describe('analytics performance probe', () => {
  beforeAll(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-perf-probe-'))
    await initDatabase(temporaryDirectory, TEST_DATABASE_FILE_NAME)
    const seedStartedAt = performance.now()
    seed()
    logProbe(`PROBE seed ${(performance.now() - seedStartedAt).toFixed(1)}ms`)
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000
    await getStatsSummary(since)
  })

  afterAll(async () => {
    await closeDatabase()
    fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  it('measures the analytics page load', async () => {
    for (const [rangeLabel, days] of [['7d', 7], ['30d', 30]] as const) {
      const since = Date.now() - days * 24 * 60 * 60 * 1000
      await time(`${rangeLabel}-stats-summary`, () => getStatsSummary(since))
      await time(`${rangeLabel}-usage-trend`, () => getUsageTrend(since))
      await time(`${rangeLabel}-provider-stats`, () => getProviderStats(since))
      await time(`${rangeLabel}-model-stats`, () => getModelStats(since, 10))
      await time(`${rangeLabel}-latency-distribution`, () => getLatencyDistribution(since))
      await time(`${rangeLabel}-failure-reasons`, () => getFailureReasons(since))
      await time(`${rangeLabel}-source-stats`, () => getRequestSourceStats(since))
      await timeMany(`${rangeLabel}-page-total`, [
        () => getStatsSummary(since),
        () => getUsageTrend(since),
        () => getProviderStats(since),
        () => getModelStats(since, 10),
        () => getLatencyDistribution(since),
        () => getFailureReasons(since),
        () => getRequestSourceStats(since),
      ])
      await time(`${rangeLabel}-provider-detail-trend`, () => getProviderAnalyticsTrend('prov_1', since, false))
      await time(`${rangeLabel}-provider-detail-models`, () => getModelStats(since, 200, 'prov_1'))
      await time(`${rangeLabel}-provider-detail-latency`, () => getLatencyDistribution(since, 'prov_1'))
      await time(`${rangeLabel}-provider-detail-failures`, () => getFailureReasons(since, 'prov_1'))
    }
    await time('intraday-trend', () => getIntradayUsageTrend(Date.now() - 24 * 60 * 60 * 1000))
    for (const [label, sqlText] of [
      ['plan-status-time', "SELECT id FROM request_logs WHERE createdTime >= 1 AND status = 'failed'"],
      ['plan-source-stats', "SELECT coalesce((SELECT value FROM request_attributes a WHERE a.requestId = r.id AND a.key = 'request.source' LIMIT 1), 'unknown') AS source, count(*) FROM request_logs r WHERE r.createdTime >= 1 GROUP BY source"],
      ['plan-usage-trend', 'SELECT strftime(\'%Y-%m-%d\', r.createdTime / 1000, \'unixepoch\', \'localtime\') AS label, sum(CASE WHEN u.type = \'inputTokens\' THEN u.value ELSE 0 END) FROM request_logs r LEFT JOIN request_usages u ON u.requestId = r.id WHERE r.createdTime >= 1 GROUP BY label'],
      ['plan-provider-trend', 'SELECT count(*), sum((SELECT sum(usage.value) FROM attempt_usages usage WHERE usage.attemptId = a.id AND usage.type = \'inputTokens\')) FROM request_attempts a JOIN request_logs r ON a.requestId = r.id WHERE r.createdTime >= 1 AND a.providerId = \'prov_1\' GROUP BY r.createdTime / 86400000'],
      ['plan-attempt-join', 'SELECT a.providerId, count(*) FROM request_attempts a JOIN request_logs r ON a.requestId = r.id WHERE r.createdTime >= 1 GROUP BY a.providerId'],
    ] as const) {
      const plans = getDb().$client.prepare(`EXPLAIN QUERY PLAN ${sqlText}`).all()
      logProbe(`PROBE ${label} ${plans.map(row => String((row as { detail?: unknown }).detail)).join(' | ')}`)
    }
  })
})
