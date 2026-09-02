import type { WorkflowNodeModel, WorkflowRunResult } from '@/pages/router/types'
import { request } from './client'

export const routerApi = {
  run: (nodes: WorkflowNodeModel[], inputPayload: unknown, signal?: AbortSignal) => request<WorkflowRunResult>('/router/run', { nodes, inputPayload }, { signal }),
}
