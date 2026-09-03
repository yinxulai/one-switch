import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { providerModelApi, schedulingPolicyApi } from '@/api/models'
import { queueApi } from '@/api/runtime'
import { requestLogApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import { calculateQueueModelMetrics, calculateQueueSummaryMetrics } from './lib/model-metrics'

type UpdateQueueModelVariables = { id: string; enabled: boolean }

export const queueKeys = {
  models: (logicalModelId: string) => ['queue-models', logicalModelId] as const,
  mode: (logicalModelId: string) => ['queue-mode', logicalModelId] as const,
  metrics: (logicalModelId: string) => ['queue-metrics', logicalModelId] as const,
}

export const useQueueModelsQuery = (logicalModelId: string) => useQuery({ queryKey: queueKeys.models(logicalModelId), queryFn: () => unwrap(providerModelApi.queue(logicalModelId)), refetchInterval: 30_000 })
export const useQueueModeQuery = (logicalModelId: string) => useQuery({ queryKey: queueKeys.mode(logicalModelId), queryFn: () => unwrap(queueApi.status(logicalModelId)), refetchInterval: 5_000 })
export const useQueueMetricsQuery = (logicalModelId: string) => useQuery({
  queryKey: queueKeys.metrics(logicalModelId),
  queryFn: async () => {
    const data = await unwrap(requestLogApi.list({ limit: 100, logicalModelId }))
    return { modelMetrics: calculateQueueModelMetrics(data.logs), summaryMetrics: calculateQueueSummaryMetrics(data.logs) }
  },
  refetchInterval: 5_000,
})
export function useSwitchQueueMutation(logicalModelId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (modelId: string | null) => unwrap(queueApi.switch(logicalModelId, modelId)),
    onSuccess: data => client.setQueryData(queueKeys.mode(logicalModelId), {
      logicalModelId: data.logicalModelId,
      manualModelId: data.modelId,
    }),
  })
}

export function useUpdateQueueModelMutation(logicalModelId: string) {
  const client = useQueryClient()
  return useMutation({ mutationFn: ({ id, enabled }: UpdateQueueModelVariables) => unwrap(schedulingPolicyApi.update({ logicalModelId, providerModelId: id, enabled })), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: queueKeys.models(logicalModelId) }), client.invalidateQueries({ queryKey: ['provider-models'] })]) } })
}
