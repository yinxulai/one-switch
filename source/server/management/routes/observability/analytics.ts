import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'
import { AnalyticsRangeSchema, type AnalyticsRange, type AnalyticsSummary, type ModelStat, type ProviderAnalyticsDetail } from '@common/schemas'
import {
  getStatsSummary,
  getUsageTrend,
  getIntradayUsageTrend,
  getProviderStats,
  getProviderStat,
  getProviderAnalyticsTrend,
  getModelStats,
  getLatencyDistribution,
  getFailureReasons,
  getRequestSourceStats,
  type ModelStat as DatabaseModelStat,
} from '@server/database/analytics-store'
import { HttpRouter } from '@server/http-router'

export const analyticsRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/analytics/summary', handleAnalyticsSummary)
  .post('/api/analytics/provider-detail', handleProviderAnalyticsDetail)

const AnalyticsSummaryRequestSchema = z.object({
  range: AnalyticsRangeSchema.optional().default('7d'),
})

const ProviderAnalyticsRequestSchema = z.object({
  providerId: z.string().trim().min(1),
  range: AnalyticsRangeSchema.optional().default('7d'),
})

function resolveSinceMs(range: AnalyticsRange): number {
  const now = Date.now()
  switch (range) {
    case 'today': {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000
    case '30d':
      return now - 30 * 24 * 60 * 60 * 1000
  }
}

async function handleAnalyticsSummary(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { range } = AnalyticsSummaryRequestSchema.parse(body ?? {})
  const sinceMs = resolveSinceMs(range)

  const trend = range === 'today' ? await getIntradayUsageTrend(sinceMs) : await getUsageTrend(sinceMs)

  const [summary, providerStats, modelStats, latencyDistribution, failureReasons, sourceStats] = await Promise.all([
    getStatsSummary(sinceMs),
    getProviderStats(sinceMs),
    getModelStats(sinceMs, 10),
    getLatencyDistribution(sinceMs),
    getFailureReasons(sinceMs),
    getRequestSourceStats(sinceMs),
  ])

  const totalProviderAttempts = providerStats.reduce((total, provider) => total + provider.attempts, 0)
  const totalFailures = summary.failedCount

  const providerStatsWithPercent = providerStats.map(p => ({
    ...p,
    percent: totalProviderAttempts > 0 ? Math.round((p.attempts / totalProviderAttempts) * 100) : 0,
  }))

  const modelStatsWithRate = modelStats.map(mapModelStat)

  // 延迟分布的口径是「成功的上游尝试」，因此分母必须是分布自身的样本总数，
  // 而不是请求数：一个请求可能贡献多次尝试，拿请求数当分母会让占比超过 100%。
  const latencySamples = latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)
  const latencyWithPercent = latencyDistribution.map(l => ({
    ...l,
    percent: latencySamples > 0 ? Math.round((l.count / latencySamples) * 100) : 0,
  }))

  const failureWithPercent = failureReasons.map(f => ({
    ...f,
    percent: totalFailures > 0 ? Math.round((f.count / totalFailures) * 100) : 0,
  }))

  const response: AnalyticsSummary = {
    summary,
    trend,
    providerStats: providerStatsWithPercent,
    modelStats: modelStatsWithRate,
    latencyDistribution: latencyWithPercent,
    failureReasons: failureWithPercent,
    sourceStats,
  }

  sendSuccess(res, response)
}

async function handleProviderAnalyticsDetail(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { providerId, range } = ProviderAnalyticsRequestSchema.parse(body ?? {})
  const sinceMs = resolveSinceMs(range)
  const provider = await getProviderStat(providerId, sinceMs)
  if (!provider) {
    sendError(res, 'RESOURCE_NOT_FOUND', `当前时间范围内没有供应商统计数据 ${providerId}`, 404)
    return
  }

  const [trend, modelStats, latencyDistribution, failureReasons] = await Promise.all([
    getProviderAnalyticsTrend(providerId, sinceMs, range === 'today'),
    getModelStats(sinceMs, 200, providerId),
    getLatencyDistribution(sinceMs, providerId),
    getFailureReasons(sinceMs, providerId),
  ])
  const latencySamples = latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)
  const failureSamples = failureReasons.reduce((total, reason) => total + reason.count, 0)
  const response: ProviderAnalyticsDetail = {
    summary: {
      ...provider,
      successRate: provider.attempts > 0 ? provider.success / provider.attempts : 0,
      totalTokens: trend.totalTokens,
    },
    requestTrend: trend.requestTrend,
    tokenTrend: trend.tokenTrend,
    models: modelStats.map(mapModelStat),
    latencyDistribution: latencyDistribution.map(bucket => ({
      ...bucket,
      percent: latencySamples > 0 ? Math.round((bucket.count / latencySamples) * 100) : 0,
    })),
    failureReasons: failureReasons.map(reason => ({
      ...reason,
      percent: failureSamples > 0 ? Math.round((reason.count / failureSamples) * 100) : 0,
    })),
  }
  sendSuccess(res, response)
}

function mapModelStat(model: DatabaseModelStat): ModelStat {
  return {
    providerModelId: model.providerModelId,
    providerModelName: model.providerModelName,
    providerId: model.providerId,
    providerName: model.providerName,
    attempts: model.attempts,
    success: model.success,
    avgLatencyMs: model.avgLatencyMs,
    avgTtftMs: model.avgTtftMs,
    // 分子与分母同口径：都只统计成功的尝试；分母已经扣掉首字延迟，
    // 是真正在产出 token 的那段时间，因此这里算出来的是生成速率。
    avgTps: model.successGenerationDurationMs > 0 && model.outputTokens > 0 ? model.outputTokens / (model.successGenerationDurationMs / 1000) : null,
    successRate: model.attempts > 0 ? model.success / model.attempts : 0,
    // 缓存读取量本就是输入量的一部分，同口径相除才是命中率。
    cacheHitRate: model.inputTokens > 0 ? model.cachedInputTokens / model.inputTokens : null,
  }
}
