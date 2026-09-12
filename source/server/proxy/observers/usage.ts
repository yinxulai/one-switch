import type { RawUsage } from '@common/schemas'

/** 从上游报文里读到的用量。字段为 `null` 表示上游没报；不是 0。 */
export interface ExtractedUsage {
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  rawUsage: RawUsage | null
}

export function emptyUsage(): ExtractedUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cachedInputTokens: null,
    cacheCreationInputTokens: null,
    rawUsage: null,
  }
}

/**
 * 用量累积器。
 *
 * 上游把用量藏在哪一层各家不同（`usage` / `usageMetadata` / `message.usage` …），
 * 也可能分散在多个 SSE 事件里（首个事件只报输入、末个事件才报输出），
 * 因此这里既能吃整段 JSON，也能逐块吃 SSE 并在返回后合并。
 *
 * 「有没有真实生成内容」由返回值告诉调用方：TTFT 只在真正收到输出时才成立，
 * 只有 role 的起始事件、只报用量的收尾事件都不算。
 */
export interface UsageTracker {
  usage(): ExtractedUsage
  /** 吃一段完整 JSON 报文；返回其中是否含有真实生成内容。 */
  consumeJson(body: string): boolean
  /** 吃一段 SSE 字节流；返回其中是否出现了真实生成内容。 */
  consumeSseChunk(text: string): boolean
  /** 收尾：把最后一段没有换行结尾的 SSE 行也吃掉。 */
  flush(): boolean
}

export function createUsageTracker(): UsageTracker {
  let usage = emptyUsage()
  let pending = ''
  return {
    usage: () => usage,
    consumeJson(body: string): boolean {
      return accumulateJson(body, current => { usage = current })
    },
    consumeSseChunk(text: string): boolean {
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      let hasOutput = false
      for (const line of lines) {
        if (accumulateSseLine(line, current => { usage = current })) hasOutput = true
      }
      return hasOutput
    },
    flush(): boolean {
      const line = pending
      pending = ''
      return accumulateSseLine(line, current => { usage = current })
    },
  }

  function accumulateSseLine(line: string, apply: (usage: ExtractedUsage) => void): boolean {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return false
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return false
    return accumulateJson(data, apply)
  }

  function accumulateJson(body: string, apply: (usage: ExtractedUsage) => void): boolean {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(body) as Record<string, unknown>
    } catch {
      // 用量是尽力而为的观察：上游事件格式不对也必须继续转发。
      return false
    }
    apply(mergeUsage(usage, extractTokenUsage(data)))
    return hasOutput(data)
  }
}

/** Only count an actual generated delta, not role-only, usage, or [DONE] events. */
export function hasOutput(data: Record<string, unknown>): boolean {
  const choices = Array.isArray(data.choices) ? data.choices : []
  for (const choice of choices) {
    const record = asRecord(choice)
    const delta = asRecord(record?.delta)
    const message = asRecord(record?.message)
    if (hasValue(delta?.content) || hasValue(delta?.tool_calls) || hasValue(delta?.function_call) || hasValue(delta?.refusal)
      || hasValue(record?.text) || hasValue(message?.content)) return true
  }

  const type = typeof data.type === 'string' ? data.type : ''
  if (type === 'content_block_delta') {
    const delta = asRecord(data.delta)
    return delta?.type === 'text_delta' && hasValue(delta.text)
  }
  if (type === 'response.output_text.delta' || type === 'response.reasoning_summary_text.delta') {
    return hasValue(data.delta)
  }
  if (type === 'response.function_call_arguments.delta') {
    return hasValue(data.delta)
  }
  return false
}

function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0
  return value !== null && value !== undefined
}

export function extractTokenUsage(data: Record<string, unknown>): ExtractedUsage {
  const candidates: RawUsage[] = []
  collectUsage(data.usage, candidates)
  collectUsage(data.usageMetadata, candidates)
  collectUsage(data.usage_metadata, candidates)
  collectUsage(asRecord(data.message)?.usage, candidates)
  collectUsage(asRecord(data.response)?.usage, candidates)
  if (Array.isArray(data.output)) {
    for (const item of data.output) collectUsage(asRecord(item)?.usage, candidates)
  }

  let rawUsage: RawUsage | null = null
  for (const candidate of candidates) rawUsage = mergeRawUsage(rawUsage, candidate)
  const cacheCreation = asRecord(rawUsage?.cache_creation)
  const promptDetails = asRecord(rawUsage?.prompt_tokens_details)
  const inputDetails = asRecord(rawUsage?.input_tokens_details)
  const cachedInputTokens = firstNumber(promptDetails?.cached_tokens, inputDetails?.cached_tokens, rawUsage?.cache_read_input_tokens, rawUsage?.cached_input_tokens, rawUsage?.cache_read_tokens, rawUsage?.cachedContentTokenCount, rawUsage?.total_cached_tokens)
  const cacheCreationInputTokens = firstNumber(promptDetails?.cache_write_tokens, inputDetails?.cache_write_tokens, rawUsage?.cache_creation_input_tokens, rawUsage?.cache_creation_tokens, rawUsage?.cached_creation_input_tokens, rawUsage?.cache_write_tokens, sumNumbers(cacheCreation?.ephemeral_5m_input_tokens, cacheCreation?.ephemeral_1h_input_tokens))
  const reportedInputTokens = firstNumber(rawUsage?.prompt_tokens, rawUsage?.input_tokens, rawUsage?.total_input_tokens, rawUsage?.promptTokenCount, data.input_tokens, data.prompt_tokens)
  const usesAnthropicInputSemantics = rawUsage?.cache_read_input_tokens !== undefined
    || rawUsage?.cache_creation_input_tokens !== undefined
    || rawUsage?.cache_creation !== undefined
  return {
    inputTokens: reportedInputTokens === null || !usesAnthropicInputSemantics
      ? reportedInputTokens
      : reportedInputTokens + (cachedInputTokens ?? 0) + (cacheCreationInputTokens ?? 0),
    outputTokens: firstNumber(rawUsage?.completion_tokens, rawUsage?.output_tokens, rawUsage?.total_output_tokens, rawUsage?.candidatesTokenCount, data.output_tokens, data.completion_tokens),
    cachedInputTokens,
    cacheCreationInputTokens,
    reasoningTokens: firstNumber(asRecord(rawUsage?.completion_tokens_details)?.reasoning_tokens, asRecord(rawUsage?.output_tokens_details)?.reasoning_tokens, rawUsage?.reasoning_tokens),
    rawUsage,
  }
}

function mergeUsage(current: ExtractedUsage, incoming: ExtractedUsage): ExtractedUsage {
  return {
    inputTokens: incoming.inputTokens ?? current.inputTokens,
    outputTokens: incoming.outputTokens ?? current.outputTokens,
    cachedInputTokens: incoming.cachedInputTokens ?? current.cachedInputTokens,
    cacheCreationInputTokens: incoming.cacheCreationInputTokens ?? current.cacheCreationInputTokens,
    reasoningTokens: incoming.reasoningTokens ?? current.reasoningTokens,
    rawUsage: mergeRawUsage(current.rawUsage, incoming.rawUsage),
  }
}

function collectUsage(value: unknown, target: RawUsage[]): void {
  const usage = asRecord(value)
  if (usage) target.push(usage)
}

function asRecord(value: unknown): RawUsage | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RawUsage : null
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function sumNumbers(...values: unknown[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null
}

function mergeRawUsage(current: RawUsage | null, incoming: RawUsage | null): RawUsage | null {
  if (!incoming) return current
  if (!current) return { ...incoming }
  const merged: RawUsage = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    const currentValue = asRecord(merged[key])
    const incomingValue = asRecord(value)
    merged[key] = currentValue && incomingValue ? mergeRawUsage(currentValue, incomingValue) : value
  }
  return merged
}
