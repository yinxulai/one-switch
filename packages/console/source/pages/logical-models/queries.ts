import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { providerModelApi, schedulingPolicyApi } from '@/api/models'
import { logicalModelRoutingApi } from '@/api/runtime'
import { requestLogApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import { calculateProviderModelMetrics, calculateLogicalModelSummaryMetrics } from './lib/model-metrics'

type UpdateProviderModelVariables = { id: string; enabled: boolean }

export const logicalModelKeys = {
  models: (logicalModelId: string) => ['logical-model-provider-models', logicalModelId] as const,
  mode: (logicalModelId: string) => ['logical-model-routing-mode', logicalModelId] as const,
  metrics: (logicalModelId: string) => ['logical-model-metrics', logicalModelId] as const,
}

export const useLogicalModelProviderModelsQuery = (logicalModelId: string) => useQuery({ queryKey: logicalModelKeys.models(logicalModelId), queryFn: () => unwrap(providerModelApi.listByLogicalModel(logicalModelId)), refetchInterval: 30_000 })
export const useLogicalModelModeQuery = (logicalModelId: string) => useQuery({ queryKey: logicalModelKeys.mode(logicalModelId), queryFn: () => unwrap(logicalModelRoutingApi.status(logicalModelId)), refetchInterval: 5_000 })
export const useLogicalModelMetricsQuery = (logicalModelId: string) => useQuery({
  queryKey: logicalModelKeys.metrics(logicalModelId),
  queryFn: async () => {
    const data = await unwrap(requestLogApi.list({ limit: 100, logicalModelId }))
    return { modelMetrics: calculateProviderModelMetrics(data.logs), summaryMetrics: calculateLogicalModelSummaryMetrics(data.logs) }
  },
  refetchInterval: 5_000,
})
export function useSwitchManualModelMutation(logicalModelId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (modelId: string | null) => unwrap(logicalModelRoutingApi.switch(logicalModelId, modelId)),
    onSuccess: data => client.setQueryData(logicalModelKeys.mode(logicalModelId), {
      logicalModelId: data.logicalModelId,
      manualModelId: data.modelId,
    }),
  })
}

export function useUpdateProviderModelMutation(logicalModelId: string) {
  const client = useQueryClient()
  return useMutation({ mutationFn: ({ id, enabled }: UpdateProviderModelVariables) => unwrap(schedulingPolicyApi.update({ logicalModelId, providerModelId: id, enabled })), onSuccess: async () => { await Promise.all([client.invalidateQueries({ queryKey: logicalModelKeys.models(logicalModelId) }), client.invalidateQueries({ queryKey: ['provider-models'] })]) } })
}
