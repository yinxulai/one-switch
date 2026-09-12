import { asArray, asNumber, asObject, asString, type Json } from './conversion-utils'

/**
 * OpenAI Chat Completions 响应 → OpenAI Responses 响应。
 *
 * Responses 的响应体不是 Chat Completions 的字段改名，而是「事件/输出项」模型：
 * 非流式返回 `output[]` 项列表，流式则要补齐 output_item / content_part /
 * output_text / function_call_arguments 的完整生命周期事件。转换器据此重建一套
 * 合法的 Responses 事件序列，而不是只翻译文本增量。
 */

function openAiUsageToResponses(usage: Json | null): Json | undefined {
  if (!usage) return undefined
  const input = asNumber(usage.prompt_tokens) ?? asNumber(usage.input_tokens)
  const output = asNumber(usage.completion_tokens) ?? asNumber(usage.output_tokens)
  if (input === undefined && output === undefined) return undefined
  const promptDetails = asObject(usage.prompt_tokens_details) ?? asObject(usage.input_tokens_details)
  const completionDetails = asObject(usage.completion_tokens_details) ?? asObject(usage.output_tokens_details)
  const reasoning = asNumber(completionDetails?.reasoning_tokens)
  return {
    ...(input !== undefined ? { input_tokens: input } : {}),
    ...(promptDetails ? { input_tokens_details: promptDetails } : {}),
    ...(output !== undefined ? { output_tokens: output } : {}),
    ...(reasoning !== undefined ? { output_tokens_details: { reasoning_tokens: reasoning } } : {}),
    ...(input !== undefined || output !== undefined ? { total_tokens: (input ?? 0) + (output ?? 0) } : {}),
  }
}

function openAiContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  return asArray(content).map(part => asString(asObject(part)?.text) ?? '').join('')
}

function outputTextPart(text: string): Json {
  return { type: 'output_text', text, annotations: [] }
}

function messageItem(id: string, text: string, status: 'in_progress' | 'completed'): Json {
  return { id, type: 'message', status, role: 'assistant', content: status === 'completed' ? [outputTextPart(text)] : [] }
}

export function openAiResponseToResponses(body: Json): Json {
  const id = asString(body.id) ?? ''
  const first = asObject(asArray(body.choices)[0])
  const message = asObject(first?.message)
  const output: Json[] = []

  const text = openAiContentToText(message?.content)
  if (text) output.push(messageItem(`${id}_msg`, text, 'completed'))

  asArray(message?.tool_calls).forEach((rawCall, index) => {
    const call = asObject(rawCall)
    const fn = asObject(call?.function)
    const name = asString(fn?.name)
    if (!call || !fn || !name) return
    output.push({
      id: `${id}_fc_${index}`,
      type: 'function_call',
      status: 'completed',
      call_id: asString(call.id) ?? '',
      name,
      arguments: asString(fn.arguments) ?? '',
    })
  })

  const usage = openAiUsageToResponses(asObject(body.usage))
  return {
    id,
    object: 'response',
    created_at: asNumber(body.created) ?? Math.floor(Date.now() / 1000),
    status: 'completed',
    model: asString(body.model) ?? '',
    output,
    ...(usage ? { usage } : {}),
  }
}

interface ResponsesToolItemState {
  outputIndex: number
  itemId: string
  callId: string
  name: string
  arguments: string
  added: boolean
  closed: boolean
}

export interface OpenAiToResponsesState {
  started: boolean
  completed: boolean
  id: string
  model: string
  created: number
  messageItemId: string
  messageOutputIndex: number
  textStarted: boolean
  textClosed: boolean
  text: string
  /** OpenAI tool_calls[].index → Responses 输出项状态 */
  toolItems: Map<number, ResponsesToolItemState>
  nextOutputIndex: number
  usage?: Json
  finishReason?: string
}

export function createOpenAiToResponsesState(): OpenAiToResponsesState {
  return {
    started: false,
    completed: false,
    id: '',
    model: '',
    created: Math.floor(Date.now() / 1000),
    messageItemId: 'msg',
    messageOutputIndex: -1,
    textStarted: false,
    textClosed: false,
    text: '',
    toolItems: new Map(),
    nextOutputIndex: 0,
  }
}

function buildOutput(state: OpenAiToResponsesState): Json[] {
  const items: Array<{ index: number; item: Json }> = []
  if (state.textStarted) items.push({ index: state.messageOutputIndex, item: messageItem(state.messageItemId, state.text, 'completed') })
  for (const item of state.toolItems.values()) {
    if (!item.added) continue
    items.push({
      index: item.outputIndex,
      item: { id: item.itemId, type: 'function_call', status: 'completed', call_id: item.callId, name: item.name, arguments: item.arguments },
    })
  }
  return items.sort((left, right) => left.index - right.index).map(entry => entry.item)
}

function buildResponse(state: OpenAiToResponsesState, status: 'in_progress' | 'completed'): Json {
  const usage = status === 'completed' ? state.usage : undefined
  return {
    id: state.id,
    object: 'response',
    created_at: state.created,
    status,
    model: state.model,
    output: status === 'completed' ? buildOutput(state) : [],
    ...(usage ? { usage } : {}),
  }
}

function ensureStarted(state: OpenAiToResponsesState, events: Json[]): void {
  if (state.started) return
  state.started = true
  events.push({ type: 'response.created', response: buildResponse(state, 'in_progress') })
  events.push({ type: 'response.in_progress', response: buildResponse(state, 'in_progress') })
}

function openTextItem(state: OpenAiToResponsesState, events: Json[]): void {
  state.textStarted = true
  state.messageItemId = `${state.id}_msg`
  state.messageOutputIndex = state.nextOutputIndex++
  events.push({ type: 'response.output_item.added', output_index: state.messageOutputIndex, item: messageItem(state.messageItemId, '', 'in_progress') })
  events.push({ type: 'response.content_part.added', item_id: state.messageItemId, output_index: state.messageOutputIndex, content_index: 0, part: outputTextPart('') })
}

/** 文本块结束后依次发出 text.done / content_part.done / output_item.done。 */
function closeTextItem(state: OpenAiToResponsesState, events: Json[]): void {
  if (!state.textStarted || state.textClosed) return
  state.textClosed = true
  events.push({ type: 'response.output_text.done', item_id: state.messageItemId, output_index: state.messageOutputIndex, content_index: 0, text: state.text })
  events.push({ type: 'response.content_part.done', item_id: state.messageItemId, output_index: state.messageOutputIndex, content_index: 0, part: outputTextPart(state.text) })
  events.push({ type: 'response.output_item.done', output_index: state.messageOutputIndex, item: messageItem(state.messageItemId, state.text, 'completed') })
}

function closeToolItem(item: ResponsesToolItemState, events: Json[]): void {
  if (!item.added || item.closed) return
  item.closed = true
  events.push({ type: 'response.function_call_arguments.done', item_id: item.itemId, output_index: item.outputIndex, arguments: item.arguments })
  events.push({
    type: 'response.output_item.done',
    output_index: item.outputIndex,
    item: { id: item.itemId, type: 'function_call', status: 'completed', call_id: item.callId, name: item.name, arguments: item.arguments },
  })
}

function closeOpenItems(state: OpenAiToResponsesState, events: Json[]): void {
  closeTextItem(state, events)
  for (const item of state.toolItems.values()) closeToolItem(item, events)
}

function complete(state: OpenAiToResponsesState, events: Json[]): void {
  if (state.completed) return
  ensureStarted(state, events)
  closeOpenItems(state, events)
  state.completed = true
  events.push({ type: 'response.completed', response: buildResponse(state, 'completed') })
}

export function openAiChunkToResponsesEvents(chunk: Json, state: OpenAiToResponsesState): Json[] {
  const events: Json[] = []
  const first = asObject(asArray(chunk.choices)[0])
  const delta = asObject(first?.delta)
  state.id = asString(chunk.id) ?? state.id
  state.model = asString(chunk.model) ?? state.model
  state.created = asNumber(chunk.created) ?? state.created

  const text = openAiContentToText(delta?.content)
  if (text) {
    ensureStarted(state, events)
    if (!state.textStarted) openTextItem(state, events)
    state.text += text
    events.push({ type: 'response.output_text.delta', item_id: state.messageItemId, output_index: state.messageOutputIndex, content_index: 0, delta: text })
  }

  for (const rawCall of asArray(delta?.tool_calls)) {
    const call = asObject(rawCall)
    if (!call) continue
    ensureStarted(state, events)
    // 文本与工具调用分属不同输出项，切换前先收尾文本项
    closeTextItem(state, events)

    const openAiIndex = asNumber(call.index) ?? 0
    let item = state.toolItems.get(openAiIndex)
    if (!item) {
      const outputIndex = state.nextOutputIndex++
      item = {
        outputIndex,
        itemId: `${state.id}_fc_${outputIndex}`,
        callId: asString(call.id) ?? '',
        name: asString(asObject(call.function)?.name) ?? '',
        arguments: '',
        added: false,
        closed: false,
      }
      state.toolItems.set(openAiIndex, item)
    }
    if (!item.added) {
      item.added = true
      events.push({
        type: 'response.output_item.added',
        output_index: item.outputIndex,
        item: { id: item.itemId, type: 'function_call', status: 'in_progress', call_id: item.callId, name: item.name, arguments: '' },
      })
    }
    const argumentsDelta = asString(asObject(call.function)?.arguments)
    if (argumentsDelta) {
      item.arguments += argumentsDelta
      events.push({ type: 'response.function_call_arguments.delta', item_id: item.itemId, output_index: item.outputIndex, delta: argumentsDelta })
    }
  }

  const finish = asString(first?.finish_reason)
  if (finish) state.finishReason = finish
  const usage = openAiUsageToResponses(asObject(chunk.usage))
  if (usage) state.usage = usage

  if (state.finishReason) closeOpenItems(state, events)
  // 与 Anthropic 方向一致：拿到 finish_reason 与 usage 后收尾；usage 缺失时留待 flush
  if (state.finishReason && state.usage) complete(state, events)
  return events
}

export function finishOpenAiToResponses(state: OpenAiToResponsesState): Json[] {
  if (!state.started || state.completed) return []
  const events: Json[] = []
  complete(state, events)
  return events
}
