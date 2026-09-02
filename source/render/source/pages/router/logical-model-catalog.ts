import type { WorkflowProtocol } from './types'

export interface LogicalModelCatalogEntry {
  id: string
  label: string
  targetQueue: string
  supportedProtocols: WorkflowProtocol[]
  enabled: boolean
}

export const LOGICAL_MODEL_CATALOG: LogicalModelCatalogEntry[] = [
  {
    id: 'logical-chat-vip',
    label: 'Logical Chat VIP',
    targetQueue: 'queue-vip-cn',
    supportedProtocols: ['openai-completions', 'openai-responses', 'anthropic-messages'],
    enabled: true,
  },
  {
    id: 'logical-chat-default',
    label: 'Logical Chat Default',
    targetQueue: 'queue-default',
    supportedProtocols: ['openai-completions', 'openai-responses', 'anthropic-messages', 'unknown'],
    enabled: true,
  },
  {
    id: 'logical-chat-low-priority',
    label: 'Logical Chat Low Priority',
    targetQueue: 'queue-low-priority',
    supportedProtocols: ['openai-completions', 'openai-responses', 'anthropic-messages', 'unknown'],
    enabled: true,
  },
]

export function getLogicalModelById(modelId: string): LogicalModelCatalogEntry | undefined {
  return LOGICAL_MODEL_CATALOG.find(item => item.id === modelId)
}
