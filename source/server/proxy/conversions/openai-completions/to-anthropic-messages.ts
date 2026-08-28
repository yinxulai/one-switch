import type { Protocol } from '@common/schemas'
import { asArray, asNumber, asObject, asString, type Json } from '../shared/json'
import { contentBlocksToText } from '../shared/content'
import { parseSseIncremental, serializeSseEvent } from '../shared/sse'
import type { StreamConverter } from '../types'

export const sourceProtocol: Protocol = 'openai-completions'
export const targetProtocol: Protocol = 'anthropic-messages'

export function convertRequest(body: Json, model: string): Json {
  const system: string[] = []
  const messages: Json[] = []

  for (const raw of asArray(body.messages)) {
    const message = asObject(raw)
    if (!message) continue
    const role = asString(message.role) ?? 'user'

    if (role === 'system' || role === 'developer') {
      const text = contentBlocksToText(message.content)
      if (text) system.push(text)
      continue
    }

    const content: Json[] = []
    for (const rawCall of asArray(message.tool_calls)) {
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

    if (role === 'tool') {
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: asString(message.tool_call_id) ?? '',
          content: asString(message.content) ?? '',
        }],
      })
      continue
    }

    if (typeof message.content === 'string') {
      if (message.content) content.push({ type: 'text', text: message.content })
    } else {
      for (const part of asArray(message.content)) {
        const record = asObject(part)
        if (!record) continue
        if (record.type === 'text') {
          const text = asString(record.text)
          if (text) content.push({ type: 'text', text })
        } else if (record.type === 'image_url' && asObject(record.image_url)) {
          const imageUrl = asObject(record.image_url)!
          const url = asString(imageUrl.url) ?? ''
          const match = /^data:([^;]+);base64,(.+)$/.exec(url)
          if (match) {
            content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } })
          } else if (url) {
            content.push({ type: 'image', source: { type: 'url', url } })
          }
        }
      }
    }

    messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content })
  }

  const result: Json = {
    model,
    messages,
    max_tokens: asNumber(body.max_tokens) ?? 4096,
  }
  if (system.length > 0) result.system = system.join('\n\n')

  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true
  if (body.stop) result.stop_sequences = body.stop

  const tools = asArray(body.tools)
    .map((raw): Json | null => {
      const tool = asObject(raw)
      const fn = asObject(tool?.function)
      return fn && asString(fn.name)
        ? {
          name: fn.name,
          description: asString(fn.description) ?? '',
          input_schema: asObject(fn.parameters) ?? { type: 'object', properties: {} },
        }
        : null
    })
    .filter((tool): tool is Json => tool !== null)
  if (tools.length > 0) result.tools = tools

  const choice = body.tool_choice
  if (choice === 'auto' || choice === 'none') {
    result.tool_choice = { type: choice === 'none' ? 'none' : 'auto' }
  } else if (choice === 'required') {
    result.tool_choice = { type: 'any' }
  } else {
    const choiceObject = asObject(choice)
    const fn = asObject(choiceObject?.function)
    const fnName = fn ? asString(fn.name) : undefined
    if (choiceObject?.type === 'function' && fnName) {
      result.tool_choice = { type: 'tool', name: fnName }
    }
  }

  return result
}

function anthropicUsageToOpenAi(usage: Json | null): Json | undefined {
  if (!usage) return undefined
  const input = asNumber(usage.input_tokens)
  const output = asNumber(usage.output_tokens)
  if (input === undefined && output === undefined) return undefined
  const cached = asNumber(usage.cache_read_input_tokens)
  return {
    prompt_tokens: input ?? 0,
    completion_tokens: output ?? 0,
    ...(cached !== undefined ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
  }
}

function anthropicStopToOpenAiFinish(stop: string | undefined): string {
  switch (stop) {
    case 'end_turn': return 'stop'
    case 'max_tokens': return 'length'
    case 'stop_sequence': return 'stop'
    case 'tool_use': return 'tool_calls'
    default: return 'stop'
  }
}

export function convertResponse(body: Json): Json {
  const content = asArray(body.content)
  const text = contentBlocksToText(content)
  const toolCalls = content.flatMap(raw => {
    const block = asObject(raw)
    return block?.type === 'tool_use'
      ? [{
        id: asString(block.id) ?? '',
        type: 'function',
        function: {
          name: asString(block.name) ?? '',
          arguments: JSON.stringify(asObject(block.input) ?? {}),
        },
      }]
      : []
  })
  const usage = anthropicUsageToOpenAi(asObject(body.usage))
  return {
    id: asString(body.id) ?? '',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: asString(body.model) ?? '',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : anthropicStopToOpenAiFinish(asString(body.stop_reason)),
    }],
    ...(usage ? { usage } : {}),
  }
}

interface StreamState {
  id: string
  model: string
  toolCalls: Map<number, { id: string; name: string }>
  started: boolean
}

function eventToChunks(event: Json, state: StreamState): Json[] {
  const chunks: Json[] = []
  const message = asObject(event.message)
  if (event.type === 'message_start') {
    state.started = true
    state.id = asString(message?.id) ?? state.id
    state.model = asString(message?.model) ?? state.model
    chunks.push({
      id: state.id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: state.model,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    })
  } else if (event.type === 'content_block_start') {
    const block = asObject(event.content_block)
    const index = asNumber(event.index) ?? 0
    if (block?.type === 'tool_use') {
      const id = asString(block.id) ?? ''
      const name = asString(block.name) ?? ''
      state.toolCalls.set(index, { id, name })
      chunks.push({
        id: state.id,
        object: 'chat.completion.chunk',
        model: state.model,
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index, id, type: 'function', function: { name, arguments: '' } }] },
          finish_reason: null,
        }],
      })
    }
  } else if (event.type === 'content_block_delta') {
    const delta = asObject(event.delta)
    const text = delta?.type === 'text_delta' ? asString(delta.text) : undefined
    const partialJson = delta?.type === 'input_json_delta' ? asString(delta.partial_json) : undefined
    if (text) {
      chunks.push({
        id: state.id,
        object: 'chat.completion.chunk',
        model: state.model,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      })
    }
    if (partialJson) {
      chunks.push({
        id: state.id,
        object: 'chat.completion.chunk',
        model: state.model,
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: asNumber(event.index) ?? 0, function: { arguments: partialJson } }] },
          finish_reason: null,
        }],
      })
    }
  } else if (event.type === 'message_delta') {
    const usage = anthropicUsageToOpenAi(asObject(event.usage))
    const delta = asObject(event.delta)
    chunks.push({
      id: state.id,
      object: 'chat.completion.chunk',
      model: state.model,
      choices: [{ index: 0, delta: {}, finish_reason: anthropicStopToOpenAiFinish(asString(delta?.stop_reason)) }],
      ...(usage ? { usage } : {}),
    })
  }
  return chunks
}

export function createStreamConverter(): StreamConverter {
  let buffer = ''
  const state: StreamState = {
    id: '',
    model: '',
    toolCalls: new Map(),
    started: false,
  }

  const convertEvent = (eventName: string | undefined, data: string): string => {
    let payload: Json
    try {
      payload = JSON.parse(data) as Json
    } catch {
      return serializeSseEvent({ ...(eventName ? { event: eventName } : {}), data })
    }
    return eventToChunks(payload, state)
      .map(chunk => serializeSseEvent({ data: JSON.stringify(chunk) }))
      .join('')
  }

  return {
    push(chunk: string): string {
      buffer += chunk
      const [events, rest] = parseSseIncremental(buffer)
      buffer = rest
      return events.map(event => convertEvent(event.event, event.data)).join('')
    },
    flush(): string {
      if (!buffer.trim()) return ''
      const raw = buffer
      buffer = ''
      const stripped = raw
        .split('\n')
        .map(line => (line.startsWith('data:') ? line.slice(5).trim() : line))
        .join('\n')
      return stripped.trim() ? convertEvent(undefined, stripped) : ''
    },
    finish(): string {
      return ''
    },
  }
}
