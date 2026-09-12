import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Provider } from '@common/schemas'
import { providerApi } from '@/api/providers'
import { unwrap } from '@/api/unwrap'

export const providerKeys = { all: ['providers'] as const }

/** 数据未就绪时复用的空数组，避免 `?? []` 每次渲染都产生新引用。 */
const EMPTY_PROVIDERS: Provider[] = []

const useProvidersQuery = () => useQuery({ queryKey: providerKeys.all, queryFn: () => unwrap(providerApi.list()), refetchInterval: 10_000 })
export function useProviders() { return useProvidersQuery().data ?? EMPTY_PROVIDERS }
export function useProvidersLoading() { return useProvidersQuery().isPending }
export function useProvidersError() { return useProvidersQuery().error?.message ?? null }
export function useProvidersActions() { const client = useQueryClient(); return { refresh: () => { void client.invalidateQueries({ queryKey: providerKeys.all }) } } }
