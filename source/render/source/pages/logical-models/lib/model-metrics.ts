import type { RequestLogEntry } from '@common/schemas'

export interface ProviderModelMetrics {
  sampleCount: number
  avgTps: number | null
  avgTtftMilliseconds: number | null
}

export interface LogicalModelSummaryMetrics {
  completedRequestCount: number
  successCount: number
  successRate: number | null
  avgDurationMilliseconds: number | null
  avgTps: number | null
  failoverCount: number
}

interface MetricAccumulator {
  requestIds: Set<string>
  tpsTotal: number
  tpsCount: number
  ttftTotal: number
  ttftCount: number
}

export function providerModelMetricKey(providerId: string, providerModelId: string): string {
  return `${providerId}\0${providerModelId}`
}

export function calculateLogicalModelSummaryMetrics(logs: RequestLogEntry[]): LogicalModelSummaryMetrics {
  const completedLogs = logs.filter(log => log.status === 'success' || log.status === 'failed' || log.status === 'cancelled')
  const successfulLogs = completedLogs.filter(log => log.status === 'success')
  const durations = successfulLogs.map(log => log.attempts.find(attempt => attempt.status === 'success')?.durationMilliseconds ?? log.totalDurationMilliseconds).filter(duration => duration > 0)
  const tpsValues = successfulLogs.map(log => {
    const duration = log.attempts.find(attempt => attempt.status === 'success')?.durationMilliseconds ?? log.totalDurationMilliseconds
    return log.outputTokens != null && log.outputTokens > 0 && duration > 0 ? log.outputTokens * 1000 / duration : null
  }).filter((tps): tps is number => tps != null)

  return {
    completedRequestCount: completedLogs.length,
    successCount: successfulLogs.length,
    successRate: completedLogs.length > 0 ? successfulLogs.length / completedLogs.length : null,
    avgDurationMilliseconds: durations.length > 0 ? durations.reduce((total, duration) => total + duration, 0) / durations.length : null,
    avgTps: tpsValues.length > 0 ? tpsValues.reduce((total, tps) => total + tps, 0) / tpsValues.length : null,
    failoverCount: successfulLogs.filter(log => log.attempts.some(attempt => attempt.status === 'success' && attempt.attemptIndex > 0)).length,
  }
}

export function calculateProviderModelMetrics(logs: RequestLogEntry[]): Record<string, ProviderModelMetrics> {
  const accumulators = new Map<string, MetricAccumulator>()

  for (const log of logs) {
    if (log.status !== 'success') continue
    const successfulAttempt = log.attempts.find(attempt => attempt.status === 'success')
    if (!successfulAttempt) continue

    const key = providerModelMetricKey(successfulAttempt.providerId, successfulAttempt.providerModelId)
    const accumulator = accumulators.get(key) ?? {
      requestIds: new Set<string>(),
      tpsTotal: 0,
      tpsCount: 0,
      ttftTotal: 0,
      ttftCount: 0,
    }
    accumulator.requestIds.add(log.id)

    // TTFT 是尝试级样本：必须取真正成功那次尝试的值，而不是请求级派生值。
    if (successfulAttempt.ttftMilliseconds != null) {
      accumulator.ttftTotal += successfulAttempt.ttftMilliseconds
      accumulator.ttftCount += 1
    }

    const totalDurationMilliseconds = successfulAttempt.durationMilliseconds
    if (log.outputTokens != null && log.outputTokens > 0 && totalDurationMilliseconds > 0) {
      accumulator.tpsTotal += log.outputTokens * 1000 / totalDurationMilliseconds
      accumulator.tpsCount += 1
    }

    accumulators.set(key, accumulator)
  }

  return Object.fromEntries(Array.from(accumulators, ([key, accumulator]) => [key, {
    sampleCount: accumulator.requestIds.size,
    avgTps: accumulator.tpsCount > 0 ? accumulator.tpsTotal / accumulator.tpsCount : null,
    avgTtftMilliseconds: accumulator.ttftCount > 0 ? accumulator.ttftTotal / accumulator.ttftCount : null,
  }]))
}
