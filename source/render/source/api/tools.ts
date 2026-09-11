import type { Protocol } from '@common/schemas'
import { request } from './client'

export interface ModelTestResult {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  success: boolean
  statusCode?: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
  durationMilliseconds: number
}

export interface ModelTestFilters { providerIds?: string[]; modelIds?: string[] }

export const modelTestApi = {
  run: (protocol: Protocol, filters: ModelTestFilters = {}, signal?: AbortSignal) => request<{ results: ModelTestResult[] }>(
    '/model-test/run',
    { protocol, ...filters },
    { signal },
  ),
}

export const developmentApi = {
  seed: () => request<{ inserted: boolean }>('/development/seed'),
}
