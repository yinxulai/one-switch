import type { Protocol } from '@common/schemas'
import { findResponseDirection } from './conversion-registry'

/**
 * 响应转换：将上游端点协议的响应（含 SSE 流）转换回客户端协议的响应。
 * 流式转换采用增量方式：每个上游 SSE event 转换为一个下游 SSE event，
 * 不做跨 event 聚合，保证低延迟透传。
 *
 * 方向表在 `conversion-registry.ts`，本文件只管 SSE 解析/序列化与流程。
 */

type Json = Record<string, unknown>

// ========== SSE 解析与序列化 ==========

export interface SseEvent {
  event?: string
  data: string
}

/** 将 SSE 文本增量解析为完整事件；返回 [事件列表, 剩余不完整文本] */
export function parseSseIncremental(buffer: string): [SseEvent[], string] {
  const events: SseEvent[] = []
  let rest = buffer
  const boundary = /\r?\n\r?\n/
  for (;;) {
    const match = boundary.exec(rest)
    if (!match || match.index < 0) break
    const raw = rest.slice(0, match.index)
    rest = rest.slice(match.index + match[0].length)
    let eventName: string | undefined
    const dataLines: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue
      const separator = line.indexOf(':')
      const field = separator < 0 ? line : line.slice(0, separator)
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
      if (field === 'event') eventName = value
      else if (field === 'data') dataLines.push(value)
    }
    if (dataLines.length > 0) events.push({ event: eventName, data: dataLines.join('\n') })
  }
  return [events, rest]
}

export function serializeSseEvent(event: SseEvent): string {
  let out = ''
  if (event.event) out += `event: ${event.event}\n`
  out += `data: ${event.data}\n\n`
  return out
}

// ========== 响应转换入口 ==========

/** 非流式响应转换 */
export function convertResponseBody(clientProtocol: Protocol, endpointProtocol: Protocol, body: Buffer): Buffer {
  if (clientProtocol === endpointProtocol) {
    throw new Error(`Same-protocol responses must not enter the conversion path: ${clientProtocol}`)
  }

  const direction = findResponseDirection(endpointProtocol, clientProtocol)
  if (!direction) {
    throw new Error(`Unsupported response conversion direction: ${endpointProtocol} -> ${clientProtocol}`)
  }

  const payload = JSON.parse(body.toString('utf8')) as Json
  return Buffer.from(JSON.stringify(direction.convert(payload)))
}

/**
 * 流式响应转换器：喂入上游 SSE 文本增量，产出下游 SSE 文本。
 * 用法：const converter = createSseConverter(...); out = converter.push(chunk); out += converter.flush()
 */
export function createSseConverter(clientProtocol: Protocol, endpointProtocol: Protocol) {
  if (clientProtocol === endpointProtocol) {
    throw new Error(`Same-protocol streaming responses must not enter the conversion path: ${clientProtocol}`)
  }

  const direction = findResponseDirection(endpointProtocol, clientProtocol)
  if (!direction) {
    throw new Error(`Unsupported response conversion direction: ${endpointProtocol} -> ${clientProtocol}`)
  }

  let buffer = ''
  const events = direction.createSseConverter()

  /** OpenAI 上游的 [DONE] 只是结束信号，不属于任何目标协议的事件模型。 */
  const isUpstreamDoneSignal = (data: string): boolean => endpointProtocol === 'openai-completions' && data.trim() === '[DONE]'

  const convertEvent = (event: SseEvent): string => {
    let payload: Json
    try {
      payload = JSON.parse(event.data) as Json
    } catch {
      return isUpstreamDoneSignal(event.data) ? '' : serializeSseEvent(event)
    }
    return serializeEvents(events.push(payload))
  }

  /** 流结束时的收尾事件，各方向按需实现。 */
  const finishEvents = (): Json[] => events.finish()

  const serializeEvents = (events: Json[]): string => {
    let out = ''
    for (const item of events) out += serializeSseEvent({ data: JSON.stringify(item) })
    return out
  }

  return {
    push(chunk: string): string {
      buffer += chunk
      const [events, rest] = parseSseIncremental(buffer)
      buffer = rest
      let out = ''
      for (const event of events) out += convertEvent(event)
      return out
    },
    flush(): string {
      let out = ''
      if (buffer.trim()) {
        const raw = buffer
        buffer = ''
        // 剩余文本可能已含 data: 前缀，也可能只是裸 JSON
        const stripped = raw
          .split('\n')
          .map(line => (line.startsWith('data:') ? line.slice(5).trim() : line))
          .join('\n')
        if (stripped.trim()) out += convertEvent({ data: stripped })
      }
      return out + serializeEvents(finishEvents())
    },
    finish(): string {
      return serializeEvents(finishEvents())
    },
  }
}
