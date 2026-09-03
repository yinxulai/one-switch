import { useQueueMetricsQuery } from '../queries'

export function useQueueMetrics(logicalModelId: string) {
  const query = useQueueMetricsQuery(logicalModelId)
  return { modelMetrics: query.data?.modelMetrics ?? {}, summaryMetrics: query.data?.summaryMetrics, refresh: query.refetch }
}
