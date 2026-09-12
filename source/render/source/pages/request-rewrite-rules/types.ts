import type { Protocol, TransportKind } from '@common/schemas'

export type RuleStage = 'request' | 'response'
export type RuleStatusFilter = 'all' | 'enabled' | 'disabled'
export type RuleActionTarget = 'header' | 'body'
export type RuleActionOperation = 'set' | 'append' | 'remove' | 'replace'

export interface RuleAction {
  id: string
  stage: RuleStage
  target: RuleActionTarget
  operation: RuleActionOperation
  path: string
  value?: string
  replacement?: string
  regex?: boolean
}

export interface RuleTestCase {
  id: string
  name: string
  stage: RuleStage
  body: string
  headers: string
  clientProtocol: Protocol
  upstreamProtocol: Protocol
  /** 试跑时假设的传输形态；响应阶段的动作在 `http-stream` 下不适用。 */
  transport: TransportKind
}

export interface RequestRewriteRule {
  id: string
  name: string
  description: string
  enabled: boolean
  global: boolean
  /** 匹配的客户端协议；留空表示不限制。 */
  protocols: Protocol[]
  match: { clientProtocols: Protocol[]; upstreamProtocols: Protocol[] }
  actions: RuleAction[]
  testCases: RuleTestCase[]
  boundProviders: number
  /** 服务端记录的更新时间；`null` 表示这条规则还没保存过。 */
  updatedTime: number | null
}

export function formatJsonActionValue(value: unknown) {
  return typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value, null, 2)
}

export function parseJsonActionValue(value: string | undefined): unknown {
  if (value === undefined || value.trim() === '') return ''
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

/** 匹配协议与协议选择器都按枚举取值流转，展示时才经 `PROTOCOL_LABELS` 变成名字。 */
export const PROTOCOL_OPTIONS: Protocol[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
]

/** 协议标识是供应商的产品名，两种界面语言下写法相同，因此不进翻译目录。 */
export const PROTOCOL_LABELS: Record<Protocol, string> = {
  'openai-completions': 'OpenAI Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
}
