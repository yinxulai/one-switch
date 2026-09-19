import { ProtocolSchema } from '@common/schemas'
import type { Protocol } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { PROTOCOL_DISPLAY_NAMES } from '@common/protocols'

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
    { provider: 'Ollama', providerKey: 'providers.example.ollamaLocal', url: 'http://localhost:11434/v1/responses' },
  ],
  'anthropic-messages': [
    { provider: 'Anthropic', url: 'https://api.anthropic.com/v1/messages' },
  ],
}

/**
 * 协议下拉选项。展示名取自契约层（见 `PROTOCOL_DISPLAY_NAMES`）——服务端的错误文案也用它，
 * 两边不能让同一份名字各写一遍。顺序就是枚举顺序，也就是协议在界面上出现的顺序。
 */
export const PROTOCOL_OPTIONS: Array<{ value: Protocol; label: string }> = ProtocolSchema.options
  .map(value => ({ value, label: PROTOCOL_DISPLAY_NAMES[value] }))
