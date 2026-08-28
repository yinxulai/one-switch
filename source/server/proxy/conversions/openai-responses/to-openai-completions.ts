import type { Protocol } from '@common/schemas'
import { asArray, asNumber, asObject, asString, type Json } from '../shared/json'
import { parseSseIncremental, serializeSseEvent } from '../shared/sse'
import type { StreamConverter } from '../types'

export const sourceProtocol: Protocol = 'openai-responses'
export const targetProtocol: Protocol = 'openai-completions'

export function convertRequest(body: Json, model: string): Json {
  const messages: Json[] = []
  const instructions = asString(body.instructions)
  if (instructions) messages.push({ role: 'system', content: instructions })

  for (const raw of asArray(body.input)) {
    const item = asObject(raw)
    if (!item) {
      if (typeof raw === 'string') messages.push({ role: 'user', content: raw })
      continue
    }

    const role = asString(item.role) === 'assistant' ? 'assistant' : 'user'
    const parts: Json[] = []
    if (typeof item.content === 'string') {
      if (item.content) parts.push({ type: 'text', text: item.content })
    } else {
      for (const part of asArray(item.content)) {
        const record = asObject(part)
        if (!record) continue
        if (record.type === 'input_text' || record.type === 'output_text') {
          const text = asString(record.text)
          if (text) parts.push({ type: 'text', text })
        } else if (record.type === 'input_image' && asObject(record.image_url)) {
          const imageUrl = asObject(record.image_url)!
          const url = asString(imageUrl.url)
          if (url) parts.push({ type: 'image_url', image_url: { url } })
        } else if (record.type === 'function_call_output') {
          messages.push({
            role: 'tool',
            tool_call_id: asString(record.call_id) ?? '',
            content: asString(record.output) ?? '',
          })
        } else if (record.type === 'function_call') {
          messages.push({
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: asString(record.call_id) ?? '',
              type: 'function',
              function: {
                name: asString(record.name) ?? '',
                arguments: asString(record.arguments) ?? '{}',
              },
            }],
          })
        }
      }
    }

    if (parts.length === 1 && parts[0].type === 'text') {
      messages.push({ role, content: parts[0].text })
    } else if (parts.length > 0) {
      messages.push({ role, content: parts })
    }
  }

  const result: Json = { model, messages }
  const maxTokens = asNumber(body.max_output_tokens)
  if (maxTokens !== undefined) result.max_tokens = maxTokens
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true
  return result
}

export function convertResponse(body: Json): Json {
  const choices = asArray(body.choices)
  const first = asObject(choices[0])
  const message = asObject(first?.message)
  const text = asString(message?.content) ?? ''
  const usage = asObject(body.usage)

  return {
    id: asString(body.id) ?? '',
    object: 'response',
    status: 'completed',
    model: asString(body.model) ?? '',
    output: text
      ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }]
      : [],
    ...(usage ? { usage } : {}),
  }
}

function chunkToEvents(chunk: Json): Json[] {
  const events: Json[] = []
  const choices = asArray(chunk.choices)
  const delta = asObject(asObject(choices[0])?.delta)
  const text = asString(delta?.content)
  if (text) events.push({ type: 'response.output_text.delta', delta: text })

  const usage = asObject(chunk.usage)
  if (usage) events.push({ type: 'response.completed', response: { usage } })
  return events
}

export function createStreamConverter(): StreamConverter {
  let buffer = ''

  const convertEvent = (data: string): string => {
    if (data.trim() === '[DONE]') return ''
    let payload: Json
    try {
      payload = JSON.parse(data) as Json
    } catch {
      return serializeSseEvent({ data })
    }
    return chunkToEvents(payload)
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
      return stripped.trim() ? convertEvent(stripped) : ''
    },
  }
}
