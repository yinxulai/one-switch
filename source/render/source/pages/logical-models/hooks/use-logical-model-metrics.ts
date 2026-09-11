import { useLogicalModelMetricsQuery } from '../queries'

export function useLogicalModelMetrics(logicalModelId: string) {
  const query = useLogicalModelMetricsQuery(logicalModelId)
  return { modelMetrics: query.data?.modelMetrics ?? {}, summaryMetrics: query.data?.summaryMetrics, refresh: query.refetch }
}
