import type { Protocol } from '@common/schemas'
import { asArray, asNumber, asObject, asString, type Json } from '../shared/json'
import { contentBlocksToText } from '../shared/content'
import { parseSseIncremental, serializeSseEvent } from '../shared/sse'
import type { StreamConverter } from '../types'

export const sourceProtocol: Protocol = 'anthropic-messages'
export const targetProtocol: Protocol = 'openai-completions'

function contentToOpenAiParts(content: unknown): Json[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  const parts: Json[] = []
  for (const block of asArray(content)) {
    const record = asObject(block)
    if (!record) continue
    if (record.type === 'text') {
      const text = asString(record.text)
      if (text) parts.push({ type: 'text', text, ...(record.cache_control ? { cache_control: record.cache_control } : {}) })
    } else if (record.type === 'image' && asObject(record.source)) {
      const source = asObject(record.source)!
      if (source.type === 'base64' && asString(source.media_type) && asString(source.data)) {
        parts.push({ type: 'image_url', image_url: { url: `data:${source.media_type};base64,${source.data}` } })
      } else if (source.type === 'url' && asString(source.url)) {
        parts.push({ type: 'image_url', image_url: { url: source.url } })
      }
    }
  }
  return parts
}

function anthropicToolToOpenAi(tool: Json): Json | null {
  const name = asString(tool.name)
  if (!name) return null
  return {
    type: 'function',
    function: {
      name,
      description: asString(tool.description) ?? '',
      parameters: asObject(tool.input_schema) ?? { type: 'object', properties: {} },
    },
  }
}

export function convertRequest(body: Json, model: string): Json {
  const system = asString(body.system) ?? contentBlocksToText(body.system)
  const messages: Json[] = []
  if (system) messages.push({ role: 'system', content: system })

  for (const raw of asArray(body.messages)) {
    const message = asObject(raw)
    if (!message) continue
    const role = asString(message.role) === 'assistant' ? 'assistant' : 'user'
    const parts = contentToOpenAiParts(message.content)
    const toolCalls = parts.length === 0
      ? asArray(message.content).flatMap(block => {
        const record = asObject(block)
        if (record?.type !== 'tool_use' || !asString(record.name)) return []
        return [{
          id: asString(record.id) ?? '',
          type: 'function',
          function: { name: record.name, arguments: JSON.stringify(asObject(record.input) ?? {}) },
        }]
      })
      : []

    if (toolCalls.length > 0) messages.push({ role: 'assistant', content: null, tool_calls: toolCalls })
    else if (parts.length === 1 && parts[0].type === 'text') messages.push({ role, content: parts[0].text })
    else if (parts.length > 0) messages.push({ role, content: parts })
  }

  for (const raw of asArray(body.messages)) {
    const message = asObject(raw)
    if (!message || message.role !== 'user') continue
    for (const block of asArray(message.content)) {
      const record = asObject(block)
      if (record?.type === 'tool_result') {
        messages.push({
          role: 'tool',
          tool_call_id: asString(record.tool_use_id) ?? '',
          content: contentBlocksToText(record.content),
        })
      }
    }
  }

  const result: Json = { model, messages }
  const tools = asArray(body.tools)
    .map(tool => anthropicToolToOpenAi(asObject(tool) ?? {}))
    .filter((tool): tool is Json => tool !== null)
  if (tools.length > 0) result.tools = tools

  const choice = asObject(body.tool_choice)
  if (choice?.type === 'auto' || choice?.type === 'any') {
    result.tool_choice = choice.type === 'any' ? 'required' : 'auto'
  } else if (choice?.type === 'tool' && asString(choice.name)) {
    result.tool_choice = { type: 'function', function: { name: choice.name } }
  }

  const maxTokens = asNumber(body.max_tokens)
  if (maxTokens !== undefined) result.max_tokens = maxTokens
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true
  if (body.stop_sequences) result.stop = body.stop_sequences

  return result
}

function openAiUsageToAnthropic(usage: Json | null): Json | undefined {
  if (!usage) return undefined
  const input = asNumber(usage.prompt_tokens)
  const output = asNumber(usage.completion_tokens)
  if (input === undefined && output === undefined) return undefined
  const cached = asNumber(asObject(usage.prompt_tokens_details)?.cached_tokens)
  return {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    ...(cached !== undefined ? { cache_read_input_tokens: cached } : {}),
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

export function convertResponse(body: Json): Json {
  const choices = asArray(body.choices)
  const first = asObject(choices[0])
  const message = asObject(first?.message)
  const content: Json[] = []
  const text = asString(message?.content)
  if (text) content.push({ type: 'text', text })

  for (const rawCall of asArray(message?.tool_calls)) {
    const call = asObject(rawCall)
    const fn = asObject(call?.function)
    if (fn && asString(fn.name)) {
      let input: unknown = {}
      try {
        input = JSON.parse(asString(fn.arguments) ?? '{}')
      } catch {
        // Malformed tool arguments are preserved as an empty object.
      }
      content.push({ type: 'tool_use', id: asString(call?.id) ?? '', name: fn.name, input })
    }
  }

  const usage = openAiUsageToAnthropic(asObject(body.usage))
  return {
    id: asString(body.id) ?? '',
    type: 'message',
    role: 'assistant',
    model: asString(body.model) ?? '',
    content,
    stop_reason: content.some(block => block.type === 'tool_use')
      ? 'tool_use'
      : openAiFinishToAnthropicStop(asString(first?.finish_reason)),
    ...(usage ? { usage } : {}),
  }
}

interface StreamState {
  started: boolean
  textBlock: boolean
  toolBlocks: Set<number>
  stopped: boolean
  stopReason?: string
  usage?: Json
  id: string
  model: string
}

function chunkToEvents(chunk: Json, state: StreamState): Json[] {
  const events: Json[] = []
  const choices = asArray(chunk.choices)
  const first = asObject(choices[0])
  const delta = asObject(first?.delta)
  const id = asString(chunk.id) ?? state.id
  const model = asString(chunk.model) ?? state.model
  state.id = id
  state.model = model

  if (!state.started && (id || model || delta?.content || delta?.tool_calls || first?.finish_reason || chunk.usage)) {
    state.started = true
    events.push({
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })
  }

  const text = asString(delta?.content)
  if (text) {
    if (!state.textBlock) {
      state.textBlock = true
      events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    }
    events.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  }

  for (const rawCall of asArray(delta?.tool_calls)) {
    const call = asObject(rawCall)
    const index = asNumber(call?.index) ?? 0
    const fn = asObject(call?.function)
    if (!state.toolBlocks.has(index)) {
      state.toolBlocks.add(index)
      events.push({
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: asString(call?.id) ?? '',
          name: asString(fn?.name) ?? '',
          input: {},
        },
      })
    }
    const argumentsDelta = asString(fn?.arguments)
    if (argumentsDelta) {
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: argumentsDelta },
      })
    }
  }

  const finish = asString(first?.finish_reason)
  if (finish) state.stopReason = openAiFinishToAnthropicStop(finish)
  const usage = openAiUsageToAnthropic(asObject(chunk.usage))
  if (usage) state.usage = usage
  if ((usage || finish) && !state.stopped && usage) {
    state.stopped = true
    if (state.textBlock) events.push({ type: 'content_block_stop', index: 0 })
    for (const index of state.toolBlocks) events.push({ type: 'content_block_stop', index })
    events.push({ type: 'message_delta', delta: { stop_reason: state.stopReason ?? 'end_turn', stop_sequence: null }, usage })
    events.push({ type: 'message_stop' })
  }
  return events
}

function finishEvents(state: StreamState): Json[] {
  if (!state.started || state.stopped) return []
  state.stopped = true
  const events: Json[] = []
  if (state.textBlock) events.push({ type: 'content_block_stop', index: 0 })
  for (const index of state.toolBlocks) events.push({ type: 'content_block_stop', index })
  events.push({
    type: 'message_delta',
    delta: { stop_reason: state.stopReason ?? 'end_turn', stop_sequence: null },
    ...(state.usage ? { usage: state.usage } : {}),
  })
  events.push({ type: 'message_stop' })
  return events
}

export function createStreamConverter(): StreamConverter {
  let buffer = ''
  const state: StreamState = {
    started: false,
    textBlock: false,
    toolBlocks: new Set(),
    stopped: false,
    id: '',
    model: '',
  }

  const convertEvent = (data: string): string => {
    if (data.trim() === '[DONE]') return ''
    let payload: Json
    try {
      payload = JSON.parse(data) as Json
    } catch {
      return serializeSseEvent({ data })
    }
    return chunkToEvents(payload, state)
      .map(event => serializeSseEvent({ data: JSON.stringify(event) }))
      .join('')
  }

  return {
    push(chunk: string): string {
      buffer += chunk
      const [events, rest] = parseSseIncremental(buffer)
      buffer = rest
      return events.map(event => convertEvent(event.data)).join('')
    },
    flush(): string {
      if (!buffer.trim()) return ''
      const raw = buffer
      buffer = ''
      const stripped = raw
        .split('\n')
        .map(line => (line.startsWith('data:') ? line.slice(5).trim() : line))
        .join('\n')
      let out = stripped.trim() ? convertEvent(stripped) : ''
      for (const event of finishEvents(state)) out += serializeSseEvent({ data: JSON.stringify(event) })
      return out
    },
    finish(): string {
      return finishEvents(state)
        .map(event => serializeSseEvent({ data: JSON.stringify(event) }))
        .join('')
    },
  }
}
