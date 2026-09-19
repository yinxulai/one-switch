import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '@/api/unwrap'
import { providerModelApi } from '@/api/models'
import { useLogicalModels } from '@/features/logical-models/hooks'
import { useProviders } from '@/features/providers/hooks'
import { useRequestLogDetailQuery, useRequestLogsQuery, PAGE_SIZE } from './queries'
import { useRequestLogsUiStore } from './store'

export interface RequestLogFilter { providerId: string; providerModelId: string; logicalModelId: string; clientProtocol: string; status: string; createdTimeFrom: number | null; createdTimeTo: number | null }

/**
 * 这个页面的筛选下拉只需要「id + 名字」，因此它缓存的是**接口原始载荷**。
 *
 * 键必须与模型管理页的 `['provider-models']` 分开：那个键里放的是映射成
 * `ProviderModelRoute` 的编辑器数据（还会被乐观写入），两个形状不同、写入方也不同的
 * 数据共用一个缓存键时，谁先挂载谁就决定了对方读到的是什么。
 */
const PROVIDER_MODEL_OPTIONS_KEY = ['provider-model-options'] as const

export function useRequestLogsService() {
  const queryClient = useQueryClient()
  const page = useRequestLogsUiStore(state => state.page)
  const expandedId = useRequestLogsUiStore(state => state.expandedId)
  const filter = useRequestLogsUiStore(state => state.filter)
  const setPage = useRequestLogsUiStore(state => state.setPage)
  const setExpandedId = useRequestLogsUiStore(state => state.setExpandedId)
  const setFilterState = useRequestLogsUiStore(state => state.setFilter)
  const logsQuery = useRequestLogsQuery(filter, page)
  const detailQuery = useRequestLogDetailQuery(expandedId)
  const providers = useProviders()
  const logicalModels = useLogicalModels()
  const providerModelsQuery = useQuery({ queryKey: PROVIDER_MODEL_OPTIONS_KEY, queryFn: () => unwrap(providerModelApi.list()), staleTime: 30_000 })
  const providerOptions = useMemo(() => providers.map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)), [providers])
  const providerNameById = useMemo(() => new Map(providers.map(provider => [provider.id, provider.name])), [providers])
  const providerModelOptions = useMemo(() => {
    const models = providerModelsQuery.data ?? []
    return models
      .map(model => ({ id: model.id, name: `${providerNameById.get(model.providerId) ?? model.providerId} / ${model.modelName}` }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [providerModelsQuery.data, providerNameById])
  const getModelName = useCallback((id: string | null) => id === null ? '—' : logicalModels.find(model => model.id === id)?.name ?? id, [logicalModels])
  const refresh = useCallback((targetPage = page) => queryClient.invalidateQueries({ queryKey: ['request-logs', filter, targetPage] }), [filter, page, queryClient])
  const setFilter = useCallback((next: Partial<RequestLogFilter>) => { setFilterState(next) }, [setFilterState])
  const goToPage = useCallback((targetPage: number) => setPage(targetPage), [setPage])
  const error = logsQuery.error === null ? null : logsQuery.error instanceof Error ? logsQuery.error.message : String(logsQuery.error)
  const filtered = Object.values(filter).some(value => value !== 'all' && value !== null)

  return {
    logs: logsQuery.data?.logs ?? [], total: logsQuery.data?.total ?? 0,
    loading: logsQuery.isPending, refreshing: logsQuery.isFetching && !logsQuery.isPending,
    error, filtered,
    page, expandedId, filter, providers, logicalModels, providerOptions, providerModelOptions, getModelName,
    details: detailQuery.data && expandedId ? { [expandedId]: detailQuery.data } : {},
    // 只认「还没有数据」，不认后台重取：请求还挂着时详情每 1.5s 会被重取一次，
    // 那是为了拿到新的状态与用量，画面上的东西不该跟着闪一下。
    detailLoadingIds: expandedId && detailQuery.isPending ? { [expandedId]: true } : {},
    detailErrors: expandedId && detailQuery.error ? { [expandedId]: detailQuery.error.message } : {},
    loadDetail: setExpandedId, refresh, setFilter, goToPage, pageSize: PAGE_SIZE,
  }
}
