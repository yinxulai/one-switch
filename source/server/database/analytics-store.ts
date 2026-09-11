import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { RequestSourceStat, RequestStatus } from '@common/schemas'
import { getDb } from './index'
import { requestAttempts, requestLogs, requestUsages } from './schema'

/**
 * 用量表里可以求和的类型。
 *
 * `raw` 行存的是上游原始 usage 报文（数值列为 NULL），任何 `sum` 都必须绕开它：
 * 这里逐类型取值，天然只命中数值行。
 */
const USAGE_TOKEN_TYPES = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'reasoningTokens'] as const

export interface StatsSummary {
  totalRequests: number
  successCount: number
  failedCount: number
  successRate: number
  avgLatencyMs: number
  totalTokens: number
}

export async function getStatsSummary(sinceMs: number): Promise<StatsSummary> {
  const db = getDb()
  const result = db
    .select({
      total: sql<number>`count(*)`.as('total'),
      success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
      failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
      // 总耗时已经是请求表自己的列；进行中的请求还没有结果，不参与平均。
      avgLatency: sql<number>`avg(case when ${requestLogs.status} <> 'pending' then ${requestLogs.totalDurationMilliseconds} end)`.as('avgLatency'),
    })
    .from(requestLogs)
    .where(sql`${requestLogs.createdTime} >= ${sinceMs}`)
    .get()
  // 总 token 是派生值：输入 + 输出。只对数值类型求和，原始报文行不参与。
  const usageResult = db
    .select({ tokens: sql<number>`coalesce(sum(case when ${requestUsages.type} in ('inputTokens', 'outputTokens') then ${requestUsages.value} else 0 end), 0)`.as('tokens') })
    .from(requestUsages)
    .innerJoin(requestLogs, eq(requestUsages.requestId, requestLogs.id))
    .where(sql`${requestLogs.createdTime} >= ${sinceMs}`)
    .get()
  const total = result?.total ?? 0
  const success = result?.success ?? 0
  const failed = result?.failed ?? 0
  return { totalRequests: total, successCount: success, failedCount: failed, successRate: total > 0 ? success / total : 0, avgLatencyMs: result?.avgLatency ?? 0, totalTokens: usageResult?.tokens ?? 0 }
}

export interface DailyTrendPoint { label: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheCreationInputTokens: number; reasoningTokens: number }

type TrendPointRow = {
  label: string
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  reasoningTokens?: number | null
}

// 请求级用量透视。用量表每种类型一行，这里把行拧成列；
// `request_usages` 本身就是请求级视角（无判别列），与 `request_logs`
// 直接按 `requestId` 相连即可。逐类型取值意味着 `raw` 行不会进入任何一列。
const usageTrendSelect = {
  inputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'inputTokens' then ${requestUsages.value} else 0 end), 0)`.as('inputTokens'),
  outputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'outputTokens' then ${requestUsages.value} else 0 end), 0)`.as('outputTokens'),
  cachedInputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'cachedInputTokens' then ${requestUsages.value} else 0 end), 0)`.as('cachedInputTokens'),
  cacheCreationInputTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'cacheCreationInputTokens' then ${requestUsages.value} else 0 end), 0)`.as('cacheCreationInputTokens'),
  reasoningTokens: sql<number>`coalesce(sum(case when ${requestUsages.type} = 'reasoningTokens' then ${requestUsages.value} else 0 end), 0)`.as('reasoningTokens'),
}

export async function getUsageTrend(sinceMs: number): Promise<DailyTrendPoint[]> {
  const rows = getDb().select({ label: sql<string>`strftime('%Y-%m-%d', ${requestLogs.createdTime} / 1000, 'unixepoch', 'localtime')`.as('label'), ...usageTrendSelect }).from(requestLogs).leftJoin(requestUsages, eq(requestUsages.requestId, requestLogs.id)).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(sql`label`).orderBy(sql`label`).all()
  return rows.map(normalizeTrendPoint)
}

export async function getIntradayUsageTrend(sinceMs: number): Promise<DailyTrendPoint[]> {
  const intervalMs = 15 * 60 * 1000
  const sinceFloor = Math.floor(sinceMs / intervalMs) * intervalMs
  const rows = getDb().select({ bucket: sql<number>`floor((${requestLogs.createdTime} - ${sinceFloor}) / ${intervalMs})`.as('bucket'), ...usageTrendSelect }).from(requestLogs).leftJoin(requestUsages, eq(requestUsages.requestId, requestLogs.id)).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(sql`bucket`).all()
  const map = new Map(rows.map(row => [row.bucket, row]))
  const nowFloor = Math.floor(Date.now() / intervalMs) * intervalMs
  const slots = Math.floor((nowFloor - sinceFloor) / intervalMs) + 1
  return Array.from({ length: slots }, (_, bucket) => {
    const row = map.get(bucket)
    return normalizeTrendPoint({ label: formatIntradayLabel(sinceFloor + bucket * intervalMs), ...row })
  })
}

function normalizeTrendPoint(row: TrendPointRow): DailyTrendPoint {
  return { label: row.label, inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, cachedInputTokens: row.cachedInputTokens ?? 0, cacheCreationInputTokens: row.cacheCreationInputTokens ?? 0, reasoningTokens: row.reasoningTokens ?? 0 }
}

function formatIntradayLabel(startMs: number): string {
  const d = new Date(startMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export async function getRequestSourceStats(sinceMs: number, limit = 20): Promise<RequestSourceStat[]> {
  const rows = getDb().select({
    source: sql<string>`coalesce((SELECT value FROM request_attributes source_attribute WHERE source_attribute.requestId = ${requestLogs.id} AND source_attribute.key = 'request.source' LIMIT 1), 'unknown')`.as('source'),
    category: sql<string>`coalesce((SELECT value FROM request_attributes category_attribute WHERE category_attribute.requestId = ${requestLogs.id} AND category_attribute.key = 'client.category' LIMIT 1), 'unknown')`.as('category'),
    requests: sql<number>`count(*)`.as('requests'),
    success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
    failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
    // 总 token 是派生值：输入 + 输出。原始报文行不参与求和。
    totalTokens: sql<number>`coalesce(sum((SELECT usage.value FROM request_usages usage WHERE usage.requestId = ${requestLogs.id} AND usage.type IN ('inputTokens', 'outputTokens'))), 0)`.as('totalTokens'),
    // 进行中的请求还没有结果，不参与平均。
    avgLatency: sql<number>`coalesce(avg(case when ${requestLogs.status} <> 'pending' then ${requestLogs.totalDurationMilliseconds} end), 0)`.as('avgLatency'),
  }).from(requestLogs).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(sql`source`, sql`category`).orderBy(sql`requests desc`).limit(limit).all()
  return rows.map(row => ({ source: row.source, category: row.category, requests: row.requests ?? 0, success: row.success ?? 0, failed: row.failed ?? 0, totalTokens: row.totalTokens ?? 0, avgLatencyMs: row.avgLatency ?? 0 }))
}

/** 提供方统计的「一次调用」以「一次上游尝试」为单位，字段名因此叫 attempts。 */
export interface ProviderStat { providerId: string; providerName: string; attempts: number; success: number; failed: number; avgLatencyMs: number }

const providerStatSelect = {
  providerId: requestAttempts.providerId,
  // 分组键（providerId）已经确定了名称，直接把它带出来即可，不必每行再回查一次。
  providerName: sql<string>`max(${requestAttempts.providerName})`.as('providerName'),
  attempts: sql<number>`count(*)`.as('attempts'),
  success: sql<number>`sum(case when ${requestAttempts.status} = 'success' then 1 else 0 end)`.as('success'),
  failed: sql<number>`sum(case when ${requestAttempts.status} = 'failed' then 1 else 0 end)`.as('failed'),
  avgLatency: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end)`.as('avgLatency'),
}

type ProviderStatRow = { providerId: string; providerName: string; attempts: number | null; success: number | null; failed: number | null; avgLatency: number | null }

function normalizeDevelopmentProviderName(providerId: string, providerName: string): string {
  return providerId.startsWith('prov_dev_') ? providerName.replace(/（开发示例）$/, '') : providerName
}

function mapProviderStat(row: ProviderStatRow): ProviderStat {
  return { providerId: row.providerId, providerName: normalizeDevelopmentProviderName(row.providerId, row.providerName), attempts: row.attempts ?? 0, success: row.success ?? 0, failed: row.failed ?? 0, avgLatencyMs: row.avgLatency ?? 0 }
}

export async function getProviderStats(sinceMs: number): Promise<ProviderStat[]> {
  const rows = getDb().select(providerStatSelect).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(sql`${requestLogs.createdTime} >= ${sinceMs}`).groupBy(requestAttempts.providerId).orderBy(sql`attempts desc`).all()
  return rows.map(mapProviderStat)
}

export async function getProviderStat(providerId: string, sinceMs: number): Promise<ProviderStat | null> {
  const row = getDb().select(providerStatSelect).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(eq(requestAttempts.providerId, providerId), sql`${requestLogs.createdTime} >= ${sinceMs}`)).groupBy(requestAttempts.providerId).get()
  return row ? mapProviderStat(row) : null
}

export interface ProviderRequestTrendPoint { label: string; success: number; failed: number; successRate: number; avgLatencyMs: number }
export interface ProviderAnalyticsTrend { requestTrend: ProviderRequestTrendPoint[]; tokenTrend: DailyTrendPoint[]; totalTokens: number }

type ProviderTrendRow = TrendPointRow & {
  label: string
  attempts?: number | null
  success?: number | null
  failed?: number | null
  avgLatencyMs?: number | null
  totalTokens?: number | null
}

type UsageTokenType = typeof USAGE_TOKEN_TYPES[number]

/**
 * 把「按类型逐行存放」的尝试级用量拧成一组列。
 *
 * 返回不带别名的标量表达式：分组查询里在外面套一层 `sum(...)` 即可，
 * 这样同一口径只需定义一次，不会在不同查询里各写一遍而逐渐跑偏。
 *
 * 参数类型限定为数值类型，因此 `raw` 行（原始报文）永远进不了求和。
 */
function attemptUsageColumn(type: UsageTokenType): SQL<number> {
  return sql<number>`coalesce((SELECT sum(usage.value) FROM attempt_usages usage WHERE usage.attemptId = ${requestAttempts.id} AND usage.type = ${type}), 0)`
}

const providerTrendSelect = {
  attempts: sql<number>`count(*)`.as('attempts'),
  success: sql<number>`sum(case when ${requestAttempts.status} = 'success' then 1 else 0 end)`.as('success'),
  failed: sql<number>`sum(case when ${requestAttempts.status} = 'failed' then 1 else 0 end)`.as('failed'),
  avgLatencyMs: sql<number>`coalesce(avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end), 0)`.as('avgLatencyMs'),
  inputTokens: sql<number>`sum(${attemptUsageColumn('inputTokens')})`.as('inputTokens'),
  outputTokens: sql<number>`sum(${attemptUsageColumn('outputTokens')})`.as('outputTokens'),
  cachedInputTokens: sql<number>`sum(${attemptUsageColumn('cachedInputTokens')})`.as('cachedInputTokens'),
  cacheCreationInputTokens: sql<number>`sum(${attemptUsageColumn('cacheCreationInputTokens')})`.as('cacheCreationInputTokens'),
  reasoningTokens: sql<number>`sum(${attemptUsageColumn('reasoningTokens')})`.as('reasoningTokens'),
  // 总 token 是派生值：输入 + 输出；`raw` 行不放数值，不会进入其中。
  totalTokens: sql<number>`sum(${attemptUsageColumn('inputTokens')} + ${attemptUsageColumn('outputTokens')})`.as('totalTokens'),
}

export async function getProviderAnalyticsTrend(providerId: string, sinceMs: number, intraday: boolean): Promise<ProviderAnalyticsTrend> {
  const intervalMs = 15 * 60 * 1000
  const sinceFloor = Math.floor(sinceMs / intervalMs) * intervalMs
  const bucket = intraday
    ? sql<string>`floor((${requestLogs.createdTime} - ${sinceFloor}) / ${intervalMs})`
    : sql<string>`strftime('%Y-%m-%d', ${requestLogs.createdTime} / 1000, 'unixepoch', 'localtime')`
  const rows = getDb().select({ label: bucket.as('label'), ...providerTrendSelect })
    .from(requestAttempts)
    .innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id))
    .where(and(sql`${requestLogs.createdTime} >= ${sinceMs}`, eq(requestAttempts.providerId, providerId)))
    .groupBy(bucket)
    .orderBy(bucket)
    .all()
  const normalizedRows = intraday ? fillIntradayProviderTrend(rows, sinceMs) : rows.map(row => ({ ...row, label: String(row.label) }))
  return {
    requestTrend: normalizedRows.map(normalizeProviderRequestTrendPoint),
    tokenTrend: normalizedRows.map(normalizeTrendPoint),
    totalTokens: rows.reduce((total, row) => total + (row.totalTokens ?? 0), 0),
  }
}

function fillIntradayProviderTrend(rows: ProviderTrendRow[], sinceMs: number): ProviderTrendRow[] {
  const intervalMs = 15 * 60 * 1000
  const map = new Map(rows.map(row => [Number(row.label), row]))
  const sinceFloor = Math.floor(sinceMs / intervalMs) * intervalMs
  const nowFloor = Math.floor(Date.now() / intervalMs) * intervalMs
  const slots = Math.floor((nowFloor - sinceFloor) / intervalMs) + 1
  return Array.from({ length: slots }, (_, index) => ({ ...map.get(index), label: formatIntradayLabel(sinceFloor + index * intervalMs) }))
}

function normalizeProviderRequestTrendPoint(row: ProviderTrendRow): ProviderRequestTrendPoint {
  const success = row.success ?? 0
  const failed = row.failed ?? 0
  const attempts = row.attempts ?? 0
  return { label: row.label, success, failed, successRate: attempts > 0 ? success / attempts : 0, avgLatencyMs: row.avgLatencyMs ?? 0 }
}

/**
 * 单个上游模型的使用情况。
 *
 * 所有指标都以「上游尝试」为口径（因此计数字段命名为 attempts）：
 * 一个请求可能产生多次尝试，把请求级指标与尝试级指标混在同一行里算
 * 平均，结果没有任何含义。
 *
 * 除了 `attempts` / `success` 两个计数，其余指标一律只看**成功的尝试**：
 * 失败尝试既没有可用输出也没有完整耗时，混进来会让平均与比率失真（尤其是
 * 以成功耗时作分母的 TPS）。
 */
export interface ModelStat { providerModelId: string; providerModelName: string; providerId: string; providerName: string; attempts: number; success: number; avgLatencyMs: number; avgTtftMs: number | null; cachedInputTokens: number; inputTokens: number; outputTokens: number; successGenerationDurationMs: number }

export async function getModelStats(sinceMs: number, limit = 10, providerId?: string): Promise<ModelStat[]> {
  const filters = [sql`${requestLogs.createdTime} >= ${sinceMs}`]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const successOnly = (type: UsageTokenType): SQL<number> => sql<number>`sum(case when ${requestAttempts.status} = 'success' then ${attemptUsageColumn(type)} else 0 end)`
  const rows = getDb().select({
    providerModelId: requestAttempts.providerModelId,
    // 分组键（providerId + providerModelId）已经确定了名称，直接把它带出来即可。
    providerModelName: sql<string>`max(${requestAttempts.providerModelName})`.as('providerModelName'),
    providerId: requestAttempts.providerId,
    providerName: sql<string>`max(${requestAttempts.providerName})`.as('providerName'),
    attempts: sql<number>`count(*)`.as('attempts'),
    success: sql<number>`sum(case when ${requestAttempts.status} = 'success' then 1 else 0 end)`.as('success'),
    avgLatency: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end)`.as('avgLatency'),
    avgTtft: sql<number>`avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.ttftMilliseconds} end)`.as('avgTtft'),
    cachedInputTokens: successOnly('cachedInputTokens').as('cachedInputTokens'),
    inputTokens: successOnly('inputTokens').as('inputTokens'),
    outputTokens: successOnly('outputTokens').as('outputTokens'),
    // 「生成耗时」= 成功尝试的总耗时减去首字延迟，也就是真正在产出 token 的那段时间：
    // 拿含首字延迟的全程耗时当分母，流式响应的 TPS 会被严重低估。
    successGenerationDurationMs: sql<number>`sum(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} - coalesce(${requestAttempts.ttftMilliseconds}, 0) else 0 end)`.as('successGenerationDurationMs'),
  }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(...filters)).groupBy(requestAttempts.providerModelId, requestAttempts.providerId).orderBy(sql`attempts desc`).limit(limit).all()
  return rows.map(row => ({ providerModelId: row.providerModelId, providerModelName: row.providerModelName, providerId: row.providerId, providerName: normalizeDevelopmentProviderName(row.providerId, row.providerName), attempts: row.attempts ?? 0, success: row.success ?? 0, avgLatencyMs: row.avgLatency ?? 0, avgTtftMs: row.avgTtft ?? null, cachedInputTokens: row.cachedInputTokens ?? 0, inputTokens: row.inputTokens ?? 0, outputTokens: row.outputTokens ?? 0, successGenerationDurationMs: row.successGenerationDurationMs ?? 0 }))
}

export interface LatencyBucket { range: string; count: number }

function formatShortDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  const rounded = Math.round(seconds * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}s`
}

// 延迟分桶的语义化边界（毫秒）：TTFT 的感知差异并非线性，
// 100ms 与 120ms 属于同一档「首字很快」，不应被拆成两个桶。
const LATENCY_BUCKET_EDGES = [50, 100, 200, 500, 1000, 2000, 5000]

function resolveLatencyBucketIndex(value: number): number {
  const index = LATENCY_BUCKET_EDGES.findIndex(edge => value < edge)
  return index === -1 ? LATENCY_BUCKET_EDGES.length : index
}

export function formatLatencyBucketRange(index: number): string {
  if (index === 0) return `< ${formatShortDuration(LATENCY_BUCKET_EDGES[0])}`
  if (index >= LATENCY_BUCKET_EDGES.length) return `>= ${formatShortDuration(LATENCY_BUCKET_EDGES[LATENCY_BUCKET_EDGES.length - 1])}`
  return `${formatShortDuration(LATENCY_BUCKET_EDGES[index - 1])}-${formatShortDuration(LATENCY_BUCKET_EDGES[index])}`
}

// 按语义化区间统计 TTFT 分布。
//
// 口径是「成功的上游尝试」：TTFT 是每次尝试自己的事实
// （`request_attempts.ttftMilliseconds`），只有这样才能把它正确地归到
// 真正产生这段输出的提供方身上。使用请求级指标 + EXISTS 会让一次失败转
// 移的请求同时计入它尝试过的每一个提供方。
// 只看成功的尝试与 `avgLatencyMs` 保持同一口径：首字已经到达但随后失败的
// 尝试，代表不了一次可用的响应。
export async function getLatencyDistribution(sinceMs: number, providerId?: string): Promise<LatencyBucket[]> {
  const filters = [sql`${requestLogs.createdTime} >= ${sinceMs}`, eq(requestLogs.status, 'success'), sql`${requestAttempts.ttftMilliseconds} is not null`]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const rows = getDb()
    .select({ value: requestAttempts.ttftMilliseconds })
    .from(requestAttempts)
    .innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id))
    .where(and(...filters))
    .all()
  const samples = rows.flatMap(row => (row.value === null ? [] : [row.value])).sort((left, right) => left - right)
  if (samples.length === 0) return []

  const counts = new Map<number, number>()
  for (const value of samples) {
    const index = resolveLatencyBucketIndex(value)
    counts.set(index, (counts.get(index) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, count]) => ({ range: formatLatencyBucketRange(index), count }))
}

export interface FailureReasonStat { reason: string; count: number }

export async function getFailureReasons(sinceMs: number, providerId?: string): Promise<FailureReasonStat[]> {
  const finalFailedAttempt = sql`${requestAttempts.attemptIndex} = (SELECT max(final_attempt.attemptIndex) FROM request_attempts AS final_attempt WHERE final_attempt.requestId = ${requestAttempts.requestId} AND final_attempt.status = 'failed')`
  const filters = [sql`${requestLogs.createdTime} >= ${sinceMs}`, eq(requestLogs.status, 'failed'), eq(requestAttempts.status, 'failed' as RequestStatus), finalFailedAttempt]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const rows = getDb().select({ errorCode: requestAttempts.errorCode, count: sql<number>`count(distinct ${requestAttempts.requestId})`.as('count') }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(...filters)).groupBy(requestAttempts.errorCode).orderBy(sql`count desc`).all()
  const categories: Record<string, number> = { '超时': 0, '限流 (429)': 0, '服务错误 (5xx)': 0, '认证失败': 0, '其他': 0 }
  for (const row of rows) {
    const code = row.errorCode ?? 'UNKNOWN'
    if (code.includes('TIMEOUT') || code.includes('ECONNRESET') || code.includes('ETIMEDOUT')) categories['超时'] += row.count
    else if (code.includes('429') || code.includes('RATE_LIMIT')) categories['限流 (429)'] += row.count
    else if (/Status_5\d\d/.test(code) || code.includes('UPSTREAM_ERROR') || code.includes('SERVER_ERROR')) categories['服务错误 (5xx)'] += row.count
    else if (code.includes('401') || code.includes('403') || code.includes('AUTH')) categories['认证失败'] += row.count
    else categories['其他'] += row.count
  }
  return Object.entries(categories).map(([reason, count]) => ({ reason, count })).filter(row => row.count > 0).sort((left, right) => right.count - left.count)
}
