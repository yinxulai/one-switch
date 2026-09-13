import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ProviderModelRoute } from '@common/schemas'
import { logicalModelKeys, useLogicalModelProviderModelsQuery } from '../queries'

function toProviderModel(model: ProviderModelRoute): ProviderModelRoute {
  return {
    id: model.id,
    providerId: model.providerId,
    modelName: model.modelName,
    endpoints: model.endpoints.map(endpoint => ({
      protocol: endpoint.protocol,
      endpointUrl: endpoint.endpointUrl,
      customAuthHeader: endpoint.customAuthHeader,
      protocolConversionEnabled: endpoint.protocolConversionEnabled,
    })),
    priority: model.priority,
    enabled: model.enabled,
    createdTime: model.createdTime,
    updatedTime: model.updatedTime,
    deletedTime: model.deletedTime,
  }
}

export function useLogicalModelProviderModels(logicalModelId: string) {
  const client = useQueryClient()
  const query = useLogicalModelProviderModelsQuery(logicalModelId)
  const models = useMemo(() => (query.data ?? []).map(toProviderModel), [query.data])
  const loadModels = useCallback(async () => { const result = await query.refetch(); return !result.isError }, [query])
  const updateModels = useCallback((update: (models: ProviderModelRoute[]) => ProviderModelRoute[]) => client.setQueryData<ProviderModelRoute[]>(logicalModelKeys.models(logicalModelId), current => update(current ?? [])), [client, logicalModelId])
  const updateEnabledModel = useCallback((id: string, enabled: boolean) => updateModels(current => current.map(model => model.id === id ? { ...model, enabled } : model)), [updateModels])
  return { models, loading: query.isPending, loadModels, updateModels, updateEnabledModel }
}
