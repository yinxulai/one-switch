import type { Protocol } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'

export interface ProtocolExample {
  /** 品牌名，直接展示（不翻译） */
  provider: string
  /** 需要本地化的展示名，优先于 provider */
  providerKey?: UiCatalogKey
  url: string
}

export const PROTOCOL_PLACEHOLDERS: Record<Protocol, string> = {
  'openai-completions': 'https://api.openai.com/v1/chat/completions',
  'openai-responses': 'https://api.openai.com/v1/responses',
  'anthropic-messages': 'https://api.anthropic.com/v1/messages',
}

export const PROTOCOL_EXAMPLES: Record<Protocol, ProtocolExample[]> = {
  'openai-completions': [
    { provider: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions' },
    { provider: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions' },
    { provider: 'Ollama', providerKey: 'providers.example.ollamaLocal', url: 'http://localhost:11434/v1/chat/completions' },
  ],
  'openai-responses': [
    { provider: 'OpenAI', url: 'https://api.openai.com/v1/responses' },
  ],
  'anthropic-messages': [
    { provider: 'Anthropic', url: 'https://api.anthropic.com/v1/messages' },
  ],
}

export const PROTOCOL_OPTIONS = [
  { value: 'openai-completions' as Protocol, label: 'OpenAI Completions' },
  { value: 'openai-responses' as Protocol, label: 'OpenAI Responses' },
  { value: 'anthropic-messages' as Protocol, label: 'Anthropic Messages' },
]

export const PROTOCOL_SHORT_LABELS: Record<Protocol, string> = {
  'openai-completions': 'OpenAI',
  'openai-responses': 'Responses',
  'anthropic-messages': 'Anthropic',
}
