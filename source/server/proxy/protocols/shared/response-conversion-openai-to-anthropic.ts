import { asArray, asNumber, asObject, asString, safeJsonParse, type Json } from './conversion-utils'

/**
 * OpenAI Chat Completions 响应 → Anthropic Messages 响应。
 *
 * 流式转换难点：OpenAI 用 `tool_calls[].index` 标识工具调用，而 Anthropic 要求
 * content block 的 `index` 在全流内唯一且递增，文本块也不例外。因此流式状态机
 * 必须自行分配 Anthropic index，不能直接复用 OpenAI 的 tool index。
 */

function openAiUsageToAnthropic(usage: Json | null): Json | undefined {
  if (!usage) return undefined
  const input = asNumber(usage.prompt_tokens) ?? asNumber(usage.input_tokens)
  const output = asNumber(usage.completion_tokens) ?? asNumber(usage.output_tokens)
  if (input === undefined && output === undefined) return undefined
  const details = asObject(usage.prompt_tokens_details) ?? asObject(usage.input_tokens_details)
  const cached = asNumber(details?.cached_tokens)
  const created = asNumber(details?.cache_write_tokens)
  const uncached = Math.max(0, (input ?? 0) - (cached ?? 0) - (created ?? 0))
  return {
    input_tokens: uncached,
    output_tokens: output ?? 0,
    ...(cached !== undefined ? { cache_read_input_tokens: cached } : {}),
    ...(created !== undefined ? { cache_creation_input_tokens: created } : {}),
  }
}

function openAiFinishToAnthropicStop(finish: string | undefined): string {
  switch (finish) {
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    case 'content_filter': return 'refusal'
    case 'function_call':
    case 'tool_calls': return 'tool_use'
    default: return 'end_turn'
  }
}

/** OpenAI message.content 可能是字符串，也可能是 content parts 数组。 */
function openAiContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  return asArray(content)
    .map(part => asString(asObject(part)?.text) ?? '')
    .join('')
}

export function openAiResponseToAnthropic(body: Json): Json {
  const first = asObject(asArray(body.choices)[0])
  const message = asObject(first?.message)
  const content: Json[] = []
  const text = openAiContentToText(message?.content)
  if (text) content.push({ type: 'text', text })
  for (const rawCall of asArray(message?.tool_calls)) {
    const call = asObject(rawCall)
    const fn = asObject(call?.function)
    const name = asString(fn?.name)
    if (!call || !fn || !name) continue
    content.push({ type: 'tool_use', id: asString(call.id) ?? '', name, input: safeJsonParse(asString(fn.arguments), {}) })
  }
  const usage = openAiUsageToAnthropic(asObject(body.usage))
  return {
    id: asString(body.id) ?? '',
    type: 'message',
    role: 'assistant',
    model: asString(body.model) ?? '',
    content,
    stop_reason: content.some(block => block.type === 'tool_use') ? 'tool_use' : openAiFinishToAnthropicStop(asString(first?.finish_reason)),
    stop_sequence: null,
    ...(usage ? { usage } : {}),
  }
}

export interface OpenAiToAnthropicState {
  started: boolean
  stopped: boolean
  id: string
  model: string
  usage?: Json
  finishReason?: string
  /** 下一个可分配的 Anthropic content block index。 */
  nextIndex: number
  /** 文本块占用的 index，未出现文本时为 null。 */
  textBlockIndex: number | null
  /** OpenAI tool_calls[].index → Anthropic content block index。 */
  toolBlockIndexes: Map<number, number>
  /** 已打开但未关闭的 block index，按打开顺序排列。 */
  openBlockIndexes: number[]
}

export function createOpenAiToAnthropicState(): OpenAiToAnthropicState {
  return {
    started: false,
    stopped: false,
    id: '',
    model: '',
    nextIndex: 0,
    textBlockIndex: null,
    toolBlockIndexes: new Map(),
    openBlockIndexes: [],
  }
}

function ensureStarted(state: OpenAiToAnthropicState, events: Json[]): void {
  if (state.started) return
  state.started = true
  events.push({
    type: 'message_start',
    message: {
      id: state.id,
      type: 'message',
      role: 'assistant',
      model: state.model,
      content: [],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
}

function emitStop(state: OpenAiToAnthropicState, events: Json[]): void {
  if (state.stopped) return
  ensureStarted(state, events)
  state.stopped = true
  for (const index of state.openBlockIndexes) events.push({ type: 'content_block_stop', index })
  state.openBlockIndexes = []
  events.push({
    type: 'message_delta',
    delta: { stop_reason: state.finishReason ?? 'end_turn', stop_sequence: null },
    ...(state.usage ? { usage: state.usage } : {}),
  })
  events.push({ type: 'message_stop' })
}

export function openAiChunkToAnthropicEvents(chunk: Json, state: OpenAiToAnthropicState): Json[] {
  const events: Json[] = []
  const first = asObject(asArray(chunk.choices)[0])
  const delta = asObject(first?.delta)
  state.id = asString(chunk.id) ?? state.id
  state.model = asString(chunk.model) ?? state.model

  const text = openAiContentToText(delta?.content)
  if (text) {
    ensureStarted(state, events)
    if (state.textBlockIndex === null) {
      state.textBlockIndex = state.nextIndex++
      state.openBlockIndexes.push(state.textBlockIndex)
      events.push({ type: 'content_block_start', index: state.textBlockIndex, content_block: { type: 'text', text: '' } })
    }
    events.push({ type: 'content_block_delta', index: state.textBlockIndex, delta: { type: 'text_delta', text } })
  }

  for (const rawCall of asArray(delta?.tool_calls)) {
    const call = asObject(rawCall)
    if (!call) continue
    const openAiIndex = asNumber(call.index) ?? 0
    const fn = asObject(call.function)
    let blockIndex = state.toolBlockIndexes.get(openAiIndex)
    if (blockIndex === undefined) {
      ensureStarted(state, events)
      blockIndex = state.nextIndex++
      state.toolBlockIndexes.set(openAiIndex, blockIndex)
      state.openBlockIndexes.push(blockIndex)
      events.push({
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'tool_use', id: asString(call.id) ?? '', name: asString(fn?.name) ?? '', input: {} },
      })
    }
    const argumentsDelta = asString(fn?.arguments)
    if (argumentsDelta) {
      events.push({ type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: argumentsDelta } })
    }
  }

  const finish = asString(first?.finish_reason)
  if (finish) state.finishReason = openAiFinishToAnthropicStop(finish)
  const usage = openAiUsageToAnthropic(asObject(chunk.usage))
  if (usage) state.usage = { ...state.usage, ...usage }

  // 收尾条件：拿到 finish_reason 与 usage 后立即闭合；仅拿到 finish_reason 时留待
  // usage 所在的后继 chunk（stream_options.include_usage）或流结束时的 flush 处理。
  if (state.finishReason && state.usage) emitStop(state, events)
  return events
}

export function finishOpenAiToAnthropic(state: OpenAiToAnthropicState): Json[] {
  if (!state.started || state.stopped) return []
  const events: Json[] = []
  emitStop(state, events)
  return events
}
