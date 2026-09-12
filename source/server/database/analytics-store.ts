import { and, eq, gte, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { FailureReasonCategory, RequestSourceStat, RequestStatus } from '@common/schemas'
import { getDb } from './index'
import { attemptUsages, requestAttempts, requestAttributes, requestLogs, requestUsages } from './schema'

/**
 * 用量表里可以求和的类型。
 *
 * `raw` 行存的是上游原始 usage 报文（数值列为 NULL），任何 `sum` 都必须绕开它：
 * 这里逐类型取值，天然只命中数值行。
 */
const USAGE_TOKEN_TYPES = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'reasoningTokens'] as const

type UsageTokenType = typeof USAGE_TOKEN_TYPES[number]

/**
 * 「请求级总 token」的求和项：输入 + 输出。
 *
 * `raw` 行存的是上游原始报文（数值列为 NULL），`in (...)` 天然把它排除。
 */
const TOTAL_REQUEST_TOKENS = sql<number>`case when ${requestUsages.type} in ('inputTokens', 'outputTokens') then ${requestUsages.value} else 0 end`

/** 用量透视的列集合：一列对应一种数值用量类型。 */
type UsageTokenSums<T> = Record<UsageTokenType, T>

/**
 * 把「一种类型一行」的用量表拧成「一列一种类型」的五列。
 *
 * 显式列出五种类型（而不是循环拼接）是为了让子查询的列集合成为静态已知的字段，
 * 后续查询才能按类型名索引到具体的列。
 */
function usagePivotColumns(typeColumn: AnySQLiteColumn, valueColumn: AnySQLiteColumn): UsageTokenSums<SQL.Aliased<number>> {
  const sumOf = (type: UsageTokenType) => sql<number>`sum(case when ${typeColumn} = ${type} then ${valueColumn} else 0 end)`.as(type)
  return { inputTokens: sumOf('inputTokens'), outputTokens: sumOf('outputTokens'), cachedInputTokens: sumOf('cachedInputTokens'), cacheCreationInputTokens: sumOf('cacheCreationInputTokens'), reasoningTokens: sumOf('reasoningTokens') }
}

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
  //
  // 这里不再连 `request_logs`：`request_usages` 本来就是请求级视角
  // （服务该请求的那次尝试写入时把它镜像过来），它的 `createdTime` 必然不早于
  // 请求的创建时间，所以按同一时间窗过滤得到的就是同一批行，少一次 join 就少一次全表扫描。
  const usageResult = db
    .select({ tokens: sql<number>`coalesce(sum(${TOTAL_REQUEST_TOKENS}), 0)`.as('tokens') })
    .from(requestUsages)
    .where(gte(requestUsages.createdTime, sinceMs))
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

// 请求级用量透视。
//
// 用量表是「一种类型一行」，分析页要的是「一列一种类型」。以前的做法是在
// 请求表上写五列 `case when type = ...`：每一行用量都要先与它所属的请求连上，
// 分组时的中间结果是「请求 × 用量行」。改成先在用量表里按请求聚好
// （聚合后每个请求只剩一行），再左连接回请求表，扫描的行数降到原来的 1/2～1/5。
//
// 逐类型取值意味着 `raw` 行（上游原始报文，数值列为 NULL）不会进入任何一列。
function buildRequestUsagePivot(sinceMs: number) {
  return getDb()
    .select({ requestId: requestUsages.requestId, ...usagePivotColumns(requestUsages.type, requestUsages.value) })
    .from(requestUsages)
    .where(gte(requestUsages.createdTime, sinceMs))
    .groupBy(requestUsages.requestId)
    .as('request_usage_pivot')
}

type RequestUsagePivot = ReturnType<typeof buildRequestUsagePivot>

/** 透视结果按行求和：`sum(coalesce(x, 0))` 与「每行先 coalesce 再相加」等价。 */
function usageTrendSelect(pivot: RequestUsagePivot): UsageTokenSums<SQL.Aliased<number>> {
  const sumOf = (type: UsageTokenType) => sql<number>`coalesce(sum(${pivot[type]}), 0)`.as(type)
  return { inputTokens: sumOf('inputTokens'), outputTokens: sumOf('outputTokens'), cachedInputTokens: sumOf('cachedInputTokens'), cacheCreationInputTokens: sumOf('cacheCreationInputTokens'), reasoningTokens: sumOf('reasoningTokens') }
}

export async function getUsageTrend(sinceMs: number): Promise<DailyTrendPoint[]> {
  const pivot = buildRequestUsagePivot(sinceMs)
  const rows = getDb().select({ label: sql<string>`strftime('%Y-%m-%d', ${requestLogs.createdTime} / 1000, 'unixepoch', 'localtime')`.as('label'), ...usageTrendSelect(pivot) })
    .from(requestLogs)
    .leftJoin(pivot, eq(pivot.requestId, requestLogs.id))
    .where(gte(requestLogs.createdTime, sinceMs))
    .groupBy(sql`label`)
    .orderBy(sql`label`)
    .all()
  return rows.map(normalizeTrendPoint)
}

export async function getIntradayUsageTrend(sinceMs: number): Promise<DailyTrendPoint[]> {
  const intervalMs = 15 * 60 * 1000
  const sinceFloor = Math.floor(sinceMs / intervalMs) * intervalMs
  const pivot = buildRequestUsagePivot(sinceMs)
  const rows = getDb().select({ bucket: sql<number>`floor((${requestLogs.createdTime} - ${sinceFloor}) / ${intervalMs})`.as('bucket'), ...usageTrendSelect(pivot) })
    .from(requestLogs)
    .leftJoin(pivot, eq(pivot.requestId, requestLogs.id))
    .where(gte(requestLogs.createdTime, sinceMs))
    .groupBy(sql`bucket`)
    .all()
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

/**
 * 请求来源统计。
 *
 * 属性与用量都存在「一请求多行」的表里。以前是三个相关子查询逐请求回查：
 * `request_attributes` 两次、`request_usages` 一次，等于按请求数把这两张表各扫一遍。
 * 改成先各自按请求聚合好（各带自己的时间窗），再左连接回请求表：
 * 回查次数从「请求数 × 3」降到两次分组。
 *
 * `request_attributes` 的主键是 `(requestId, key)`，所以同一个 key 最多只有一行，
 * `max(case when key = ... end)` 取到的就是那一行。
 */
export async function getRequestSourceStats(sinceMs: number, limit = 20): Promise<RequestSourceStat[]> {
  const attributes = getDb().select({
    requestId: requestAttributes.requestId,
    source: sql<string>`max(case when ${requestAttributes.key} = 'request.source' then ${requestAttributes.value} end)`.as('source'),
    category: sql<string>`max(case when ${requestAttributes.key} = 'client.category' then ${requestAttributes.value} end)`.as('category'),
  }).from(requestAttributes).where(gte(requestAttributes.createdTime, sinceMs)).groupBy(requestAttributes.requestId).as('request_attribute_pivot')
  const usages = getDb().select({
    requestId: requestUsages.requestId,
    tokens: sql<number>`sum(${TOTAL_REQUEST_TOKENS})`.as('tokens'),
  }).from(requestUsages).where(gte(requestUsages.createdTime, sinceMs)).groupBy(requestUsages.requestId).as('request_usage_pivot')
  const rows = getDb().select({
    source: sql<string>`coalesce(${attributes.source}, 'unknown')`.as('source'),
    category: sql<string>`coalesce(${attributes.category}, 'unknown')`.as('category'),
    requests: sql<number>`count(*)`.as('requests'),
    success: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`.as('success'),
    failed: sql<number>`sum(case when ${requestLogs.status} = 'failed' then 1 else 0 end)`.as('failed'),
    totalTokens: sql<number>`coalesce(sum(${usages.tokens}), 0)`.as('totalTokens'),
    // 进行中的请求还没有结果，不参与平均。
    avgLatency: sql<number>`coalesce(avg(case when ${requestLogs.status} <> 'pending' then ${requestLogs.totalDurationMilliseconds} end), 0)`.as('avgLatency'),
  }).from(requestLogs)
    .leftJoin(attributes, eq(attributes.requestId, requestLogs.id))
    .leftJoin(usages, eq(usages.requestId, requestLogs.id))
    .where(gte(requestLogs.createdTime, sinceMs))
    .groupBy(sql`source`, sql`category`)
    .orderBy(sql`requests desc`)
    .limit(limit)
    .all()
  return rows.map(row => ({ source: row.source, category: row.category, requests: row.requests ?? 0, success: row.success ?? 0, failed: row.failed ?? 0, totalTokens: row.totalTokens ?? 0, avgLatencyMs: row.avgLatency ?? 0 }))
}

// 提供方统计的时间窗一律用「尝试表自己的 `createdTime`」。
//
// 尝试行的写入时间必然不早于它所属请求的创建时间，所以「请求落在窗口内」与
// 「尝试落在窗口内」是同一批尝试；而按尝试表过滤才能用上
// `(providerId, createdTime)` 索引——按请求表过滤时，SQLite 只能先按 providerId
// 把该提供方的全部历史尝试捞出来，再逐行回查请求与时间窗比对，代价与时间窗无关。

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
  // `（开发示例）` 是开发种子数据用过的**历史后缀字面量**，改了它旧开发库里的行就清不掉后缀了。
  return providerId.startsWith('prov_dev_') ? providerName.replace(/（开发示例）$/, '') : providerName
}

function mapProviderStat(row: ProviderStatRow): ProviderStat {
  return { providerId: row.providerId, providerName: normalizeDevelopmentProviderName(row.providerId, row.providerName), attempts: row.attempts ?? 0, success: row.success ?? 0, failed: row.failed ?? 0, avgLatencyMs: row.avgLatency ?? 0 }
}

export async function getProviderStats(sinceMs: number): Promise<ProviderStat[]> {
  const rows = getDb().select(providerStatSelect).from(requestAttempts).where(gte(requestAttempts.createdTime, sinceMs)).groupBy(requestAttempts.providerId).orderBy(sql`attempts desc`).all()
  return rows.map(mapProviderStat)
}

export async function getProviderStat(providerId: string, sinceMs: number): Promise<ProviderStat | null> {
  const row = getDb().select(providerStatSelect).from(requestAttempts).where(and(eq(requestAttempts.providerId, providerId), gte(requestAttempts.createdTime, sinceMs))).groupBy(requestAttempts.providerId).get()
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

/**
 * 尝试级用量透视：把「一种类型一行」拧成「一列一种类型」，同样按尝试先聚合、再左连接。
 *
 * 以前这里是五个相关子查询（`sum(coalesce((SELECT ... WHERE attemptId = 本行), 0))`）：
 * 每一条尝试都要回扫一次用量表，分组时等于把「尝试数 × 5 次索引查找」做完再求和。
 * 先聚合好再连接，一次即可。
 *
 * 逐类型取值意味着 `raw` 行（上游原始报文，数值列为 NULL）不会进入任何一列。
 */
function buildAttemptUsagePivot(sinceMs: number) {
  return getDb()
    .select({ attemptId: attemptUsages.attemptId, ...usagePivotColumns(attemptUsages.type, attemptUsages.value) })
    .from(attemptUsages)
    .where(gte(attemptUsages.createdTime, sinceMs))
    .groupBy(attemptUsages.attemptId)
    .as('attempt_usage_pivot')
}

type AttemptUsagePivot = ReturnType<typeof buildAttemptUsagePivot>

/** 透视结果按行求和（未命中透视的尝试按 0 算），并额外给出「输入 + 输出」的派生总值。 */
function providerTrendSelect(pivot: AttemptUsagePivot) {
  const sumOf = (type: UsageTokenType) => sql<number>`coalesce(sum(${pivot[type]}), 0)`
  const sums = { inputTokens: sumOf('inputTokens').as('inputTokens'), outputTokens: sumOf('outputTokens').as('outputTokens'), cachedInputTokens: sumOf('cachedInputTokens').as('cachedInputTokens'), cacheCreationInputTokens: sumOf('cacheCreationInputTokens').as('cacheCreationInputTokens'), reasoningTokens: sumOf('reasoningTokens').as('reasoningTokens') }
  return {
    attempts: sql<number>`count(*)`.as('attempts'),
    success: sql<number>`sum(case when ${requestAttempts.status} = 'success' then 1 else 0 end)`.as('success'),
    failed: sql<number>`sum(case when ${requestAttempts.status} = 'failed' then 1 else 0 end)`.as('failed'),
    avgLatencyMs: sql<number>`coalesce(avg(case when ${requestAttempts.status} = 'success' then ${requestAttempts.durationMilliseconds} end), 0)`.as('avgLatencyMs'),
    ...sums,
    // 总 token 是派生值：输入 + 输出；`raw` 行不放数值，不会进入其中。
    totalTokens: sql<number>`${sumOf('inputTokens')} + ${sumOf('outputTokens')}`.as('totalTokens'),
  }
}

export async function getProviderAnalyticsTrend(providerId: string, sinceMs: number, intraday: boolean): Promise<ProviderAnalyticsTrend> {
  const intervalMs = 15 * 60 * 1000
  const sinceFloor = Math.floor(sinceMs / intervalMs) * intervalMs
  // 时间窗按尝试表自己的 `createdTime` 收窄（与请求窗口等价，见 `getProviderStats` 上方注释），
  // 但分桶标签仍然取请求的创建时间：一次请求属于哪一天、哪个时段，是请求自己的属性。
  const bucket = intraday
    ? sql<string>`floor((${requestLogs.createdTime} - ${sinceFloor}) / ${intervalMs})`
    : sql<string>`strftime('%Y-%m-%d', ${requestLogs.createdTime} / 1000, 'unixepoch', 'localtime')`
  const pivot = buildAttemptUsagePivot(sinceMs)
  const rows = getDb().select({ label: bucket.as('label'), ...providerTrendSelect(pivot) })
    .from(requestAttempts)
    .innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id))
    .leftJoin(pivot, eq(pivot.attemptId, requestAttempts.id))
    .where(and(gte(requestAttempts.createdTime, sinceMs), eq(requestAttempts.providerId, providerId)))
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
  // 时间窗同样按尝试表自己的 `createdTime` 收窄（等价性见 `getProviderStats` 上方注释）：
  // 这里除了用量，没有任何指标来自请求表，因此整个连接都可以去掉。
  const filters = [gte(requestAttempts.createdTime, sinceMs)]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const pivot = buildAttemptUsagePivot(sinceMs)
  // 失败尝试的用量不算进这些列；未命中透视的尝试以 0 参与。
  const successOnly = (type: UsageTokenType) => sql<number>`coalesce(sum(case when ${requestAttempts.status} = 'success' then ${pivot[type]} else 0 end), 0)`
  const rows = getDb().select({
    // 排行单位是「上游模型」：一个 providerModelId 只属于一个提供方，所以只按它分组。
    // 旧实现按 (providerModelId, providerId) 分组：历史尝试里留下的旧提供方快照
    // 会把同一个模型拆成两行，排行榜上同一个模型出现两次，还要各占一个 TOP 名额。
    providerModelId: requestAttempts.providerModelId,
    providerModelName: requestAttempts.providerModelName,
    providerId: requestAttempts.providerId,
    providerName: requestAttempts.providerName,
    // 上面四个是「裸列」，取值来源由下面这个唯一的 max() 决定：
    // SQLite 在查询里只有 min()/max() 这一种极值聚合、且只出现一次时，
    // 所有裸列都取该极值所在的那一行。于是模型名与提供方一定来自同一条尝试记录，
    // 不会出现「A 家的 id 配 B 家的名字」。**新增 min()/max() 会破坏这个约定。**
    latestAttemptCreatedTime: sql<number>`max(${requestAttempts.createdTime})`.as('latestAttemptCreatedTime'),
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
  }).from(requestAttempts)
    .leftJoin(pivot, eq(pivot.attemptId, requestAttempts.id))
    .where(and(...filters))
    .groupBy(requestAttempts.providerModelId)
    // 尝试数相同时用 id 兜底：排行榜不该在多次刷新之间自己换位置。
    .orderBy(sql`attempts desc, ${requestAttempts.providerModelId} asc`)
    .limit(limit)
    .all()
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

/**
 * 把 TTFT 归到桶号的 SQL 表达式（桶号与 `formatLatencyBucketRange` 一一对应）。
 *
 * 桶边界只在这里定义一次：分桶与标签都从 `LATENCY_BUCKET_EDGES` 派生，
 * 因此不可能出现「统计的桶」与「画出来的桶」对不上的情况。
 */
const latencyBucketIndex = sql<number>`case ${sql.join(LATENCY_BUCKET_EDGES.map((edge, index) => sql`when ${requestAttempts.ttftMilliseconds} < ${edge} then ${index}`), sql` `)} else ${LATENCY_BUCKET_EDGES.length} end`

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
//
// 分桶直接在 SQL 里做：`group by 桶号` 只为出现过的桶返回一行。
// 以前是把窗口内每一个 TTFT 都取回 JS 再排序分桶，30 天窗口下等于
// 为了一张直方图把几十万个整数搬进内存再排一次序。
export async function getLatencyDistribution(sinceMs: number, providerId?: string): Promise<LatencyBucket[]> {
  const filters = [sql`${requestLogs.createdTime} >= ${sinceMs}`, eq(requestLogs.status, 'success'), sql`${requestAttempts.ttftMilliseconds} is not null`]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const rows = getDb()
    .select({ bucket: sql<number>`${latencyBucketIndex}`.as('bucket'), count: sql<number>`count(*)`.as('count') })
    .from(requestAttempts)
    .innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id))
    .where(and(...filters))
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`)
    .all()
  return rows.map(row => ({ range: formatLatencyBucketRange(row.bucket), count: row.count }))
}

export interface FailureReasonStat { reason: FailureReasonCategory; count: number }

export async function getFailureReasons(sinceMs: number, providerId?: string): Promise<FailureReasonStat[]> {
  const finalFailedAttempt = sql`${requestAttempts.attemptIndex} = (SELECT max(final_attempt.attemptIndex) FROM request_attempts AS final_attempt WHERE final_attempt.requestId = ${requestAttempts.requestId} AND final_attempt.status = 'failed')`
  const filters = [sql`${requestLogs.createdTime} >= ${sinceMs}`, eq(requestLogs.status, 'failed'), eq(requestAttempts.status, 'failed' as RequestStatus), finalFailedAttempt]
  if (providerId) filters.push(eq(requestAttempts.providerId, providerId))
  const rows = getDb().select({ errorCode: requestAttempts.errorCode, count: sql<number>`count(distinct ${requestAttempts.requestId})`.as('count') }).from(requestAttempts).innerJoin(requestLogs, eq(requestAttempts.requestId, requestLogs.id)).where(and(...filters)).groupBy(requestAttempts.errorCode).orderBy(sql`count desc`).all()
  // 桶名是机器码，界面自己翻：服务端不该决定标签长什么样（见 `FAILURE_REASON_CATEGORIES`）。
  const categories: Record<FailureReasonCategory, number> = { TIMEOUT: 0, RATE_LIMITED: 0, SERVER_ERROR: 0, AUTH_FAILED: 0, OTHER: 0 }
  for (const row of rows) {
    const code = row.errorCode ?? 'UNKNOWN'
    if (code.includes('TIMEOUT') || code.includes('ECONNRESET') || code.includes('ETIMEDOUT')) categories.TIMEOUT += row.count
    else if (code.includes('429') || code.includes('RATE_LIMIT')) categories.RATE_LIMITED += row.count
    else if (/Status_5\d\d/.test(code) || code.includes('UPSTREAM_ERROR') || code.includes('SERVER_ERROR')) categories.SERVER_ERROR += row.count
    else if (code.includes('401') || code.includes('403') || code.includes('AUTH')) categories.AUTH_FAILED += row.count
    else categories.OTHER += row.count
  }
  return Object.entries(categories).map(([reason, count]) => ({ reason: reason as FailureReasonCategory, count })).filter(row => row.count > 0).sort((left, right) => right.count - left.count)
}
