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

  it('compares aggregation strategies', async () => {
    const db = getDb().$client
    const DAY = 24 * 60 * 60 * 1000
    const variants = {
      summaryJoins: "SELECT coalesce(sum(case when u.type in ('inputTokens','outputTokens') then u.value else 0 end),0) FROM request_usages u JOIN request_logs r ON u.requestId = r.id WHERE r.createdTime >= ?",
      summaryPivotBounded: "SELECT coalesce(sum(p.tokens),0) FROM request_logs r LEFT JOIN (SELECT requestId, sum(case when type in ('inputTokens','outputTokens') then value else 0 end) AS tokens FROM request_usages WHERE createdTime >= ? GROUP BY requestId) p ON p.requestId = r.id WHERE r.createdTime >= ?",
      summaryPivotUnbounded: "SELECT coalesce(sum(p.tokens),0) FROM request_logs r LEFT JOIN (SELECT requestId, sum(case when type in ('inputTokens','outputTokens') then value else 0 end) AS tokens FROM request_usages GROUP BY requestId) p ON p.requestId = r.id WHERE r.createdTime >= ?",
      summaryPivotInSubquery: "SELECT coalesce(sum(p.tokens),0) FROM request_logs r LEFT JOIN (SELECT requestId, sum(case when type in ('inputTokens','outputTokens') then value else 0 end) AS tokens FROM request_usages WHERE requestId IN (SELECT id FROM request_logs WHERE createdTime >= ?) GROUP BY requestId) p ON p.requestId = r.id WHERE r.createdTime >= ?",
      trendJoins: "SELECT strftime('%Y-%m-%d', r.createdTime/1000,'unixepoch','localtime') AS label, sum(case when u.type='inputTokens' then u.value else 0 end) AS inputTokens, sum(case when u.type='outputTokens' then u.value else 0 end) AS outputTokens FROM request_logs r LEFT JOIN request_usages u ON u.requestId = r.id WHERE r.createdTime >= ? GROUP BY label",
      trendPivot: "SELECT strftime('%Y-%m-%d', r.createdTime/1000,'unixepoch','localtime') AS label, sum(p.inputTokens) AS inputTokens, sum(p.outputTokens) AS outputTokens FROM request_logs r LEFT JOIN (SELECT requestId, sum(case when type='inputTokens' then value else 0 end) AS inputTokens, sum(case when type='outputTokens' then value else 0 end) AS outputTokens FROM request_usages WHERE createdTime >= ? GROUP BY requestId) p ON p.requestId = r.id WHERE r.createdTime >= ? GROUP BY label",
      sourceCorrelated: "SELECT coalesce((SELECT value FROM request_attributes a WHERE a.requestId=r.id AND a.key='request.source' LIMIT 1),'unknown') AS source, coalesce((SELECT value FROM request_attributes a WHERE a.requestId=r.id AND a.key='client.category' LIMIT 1),'unknown') AS category, count(*) AS requests, coalesce(sum((SELECT usage.value FROM request_usages usage WHERE usage.requestId=r.id AND usage.type IN ('inputTokens','outputTokens'))),0) AS totalTokens FROM request_logs r WHERE r.createdTime >= ? GROUP BY source, category ORDER BY requests DESC LIMIT 20",
      sourceJoins: "SELECT coalesce(src.value,'unknown') AS source, coalesce(cat.value,'unknown') AS category, count(*) AS requests, coalesce(sum(p.tokens),0) AS totalTokens FROM request_logs r LEFT JOIN request_attributes src ON src.requestId=r.id AND src.key='request.source' LEFT JOIN request_attributes cat ON cat.requestId=r.id AND cat.key='client.category' LEFT JOIN (SELECT requestId, sum(case when type in ('inputTokens','outputTokens') then value else 0 end) AS tokens FROM request_usages WHERE createdTime >= ? GROUP BY requestId) p ON p.requestId=r.id WHERE r.createdTime >= ? GROUP BY source, category ORDER BY requests DESC LIMIT 20",
      providerCorrelated: "SELECT a.providerId, max(a.providerName) AS name, count(*) AS attempts, sum(case when a.status='success' then 1 else 0 end) AS success, avg(case when a.status='success' then a.durationMilliseconds end) AS avgLatency FROM request_attempts a JOIN request_logs r ON a.requestId=r.id WHERE r.createdTime >= ? GROUP BY a.providerId ORDER BY attempts DESC",
      providerBounded: "SELECT a.providerId, max(a.providerName) AS name, count(*) AS attempts, sum(case when a.status='success' then 1 else 0 end) AS success, avg(case when a.status='success' then a.durationMilliseconds end) AS avgLatency FROM request_attempts a JOIN request_logs r ON a.requestId=r.id WHERE r.createdTime >= ? AND a.createdTime >= ? GROUP BY a.providerId ORDER BY attempts DESC",
      modelCorrelated: "SELECT a.providerModelId, count(*) AS attempts, sum(case when a.status='success' then 1 else 0 end) AS success, sum(case when a.status='success' then (SELECT sum(value) FROM attempt_usages u WHERE u.attemptId=a.id AND u.type='inputTokens') else 0 end) AS inputTokens, sum(case when a.status='success' then (SELECT sum(value) FROM attempt_usages u WHERE u.attemptId=a.id AND u.type='outputTokens') else 0 end) AS outputTokens FROM request_attempts a JOIN request_logs r ON a.requestId=r.id WHERE r.createdTime >= ? GROUP BY a.providerModelId, a.providerId ORDER BY attempts DESC LIMIT 10",
      modelPivot: "SELECT a.providerModelId, count(*) AS attempts, sum(case when a.status='success' then 1 else 0 end) AS success, sum(case when a.status='success' then p.inputTokens else 0 end) AS inputTokens, sum(case when a.status='success' then p.outputTokens else 0 end) AS outputTokens FROM request_attempts a JOIN request_logs r ON a.requestId=r.id LEFT JOIN (SELECT attemptId, sum(case when type='inputTokens' then value else 0 end) AS inputTokens, sum(case when type='outputTokens' then value else 0 end) AS outputTokens FROM attempt_usages WHERE createdTime >= ? GROUP BY attemptId) p ON p.attemptId=a.id WHERE r.createdTime >= ? AND a.createdTime >= ? GROUP BY a.providerModelId, a.providerId ORDER BY attempts DESC LIMIT 10",
      latencySql: "SELECT CASE WHEN a.ttftMilliseconds < 50 THEN 0 WHEN a.ttftMilliseconds < 100 THEN 1 WHEN a.ttftMilliseconds < 200 THEN 2 WHEN a.ttftMilliseconds < 500 THEN 3 WHEN a.ttftMilliseconds < 1000 THEN 4 WHEN a.ttftMilliseconds < 2000 THEN 5 WHEN a.ttftMilliseconds < 5000 THEN 6 ELSE 7 END AS bucket, count(*) AS samples FROM request_attempts a JOIN request_logs r ON a.requestId=r.id WHERE r.createdTime >= ? AND r.status='success' AND a.ttftMilliseconds IS NOT NULL GROUP BY bucket ORDER BY bucket",
    } as const
    const parameterCounts: Record<keyof typeof variants, number> = {
      summaryJoins: 1, summaryPivotBounded: 2, summaryPivotUnbounded: 1, summaryPivotInSubquery: 2,
      trendJoins: 1, trendPivot: 2, sourceCorrelated: 1, sourceJoins: 2, providerCorrelated: 1,
      providerBounded: 2, modelCorrelated: 1, modelPivot: 3, latencySql: 1,
    }

    function runVariant(name: keyof typeof variants, since: number): void {
      const parameters = Array.from({ length: parameterCounts[name] }, () => since)
      db.prepare(variants[name]).all(...parameters)
    }

    function measure(name: keyof typeof variants, since: number): number {
      runVariant(name, since)
      const startedAt = performance.now()
      runVariant(name, since)
      return performance.now() - startedAt
    }

    for (const [rangeLabel, days] of [['7d', 7], ['30d', 30]] as const) {
      const since = Date.now() - days * DAY
      const results = Object.keys(variants).map(name => `${name}=${measure(name as keyof typeof variants, since).toFixed(1)}ms`)
      logProbe(`PROBE variants-${rangeLabel}-before-index ${results.join(' ')}`)
    }

    for (const statement of [
      'CREATE INDEX idx_probe_logs_status_created ON request_logs(status, createdTime)',
      'CREATE INDEX idx_probe_attempts_created ON request_attempts(createdTime)',
      'CREATE INDEX idx_probe_attempt_usages_created ON attempt_usages(createdTime)',
      'CREATE INDEX idx_probe_request_usages_created ON request_usages(createdTime)',
    ]) {
      db.exec(statement)
    }

    for (const [rangeLabel, days] of [['7d', 7], ['30d', 30]] as const) {
      const since = Date.now() - days * DAY
      const results = Object.keys(variants).map(name => `${name}=${measure(name as keyof typeof variants, since).toFixed(1)}ms`)
      logProbe(`PROBE variants-${rangeLabel}-after-index ${results.join(' ')}`)
    }

    for (const [label, sqlText] of [
      ['plan-source-joins', variants.sourceJoins],
      ['plan-model-pivot', variants.modelPivot],
      ['plan-trend-pivot', variants.trendPivot],
      ['plan-latency-sql', variants.latencySql],
    ] as const) {
      const plans = db.prepare(`EXPLAIN QUERY PLAN ${sqlText}`).all(...Array.from({ length: parameterCounts[label === 'plan-source-joins' ? 'sourceJoins' : label === 'plan-model-pivot' ? 'modelPivot' : label === 'plan-trend-pivot' ? 'trendPivot' : 'latencySql'] }, () => Date.now() - 7 * DAY))
      logProbe(`PROBE ${label} ${plans.map(row => String((row as { detail?: unknown }).detail)).join(' | ')}`)
    }
  }, 600_000)

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
  }, 600_000)
})
