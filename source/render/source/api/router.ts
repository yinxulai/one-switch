import type { WorkflowGraph, WorkflowRunResult } from '@/pages/router/types'
import { request } from './client'

export const routerApi = {
  run: (graph: WorkflowGraph, inputPayload: unknown, signal?: AbortSignal) => request<WorkflowRunResult>('/router/run', { graph, inputPayload }, { signal }),
}
