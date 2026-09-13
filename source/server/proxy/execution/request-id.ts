import type { HeaderMap } from '@server/proxy/contracts'

/**
 * 上游自己的请求 id。
 *
 * 各家放在不同的头里，因此按常见程度依次找；找不到就是找不到，不用本地 id 顶替——
 * 上游请求 id 的唯一用途是「拿它去问上游」，编一个出来只会误导排查。
 */
export function extractUpstreamRequestId(headers: HeaderMap): string | null {
  const candidates = [
    headers['x-request-id'],
    headers['request-id'],
    headers['anthropic-request-id'],
    headers['x-correlation-id'],
    headers['x-amzn-requestid'],
    headers['x-goog-request-id'],
  ]
  for (const value of candidates) {
    const id = Array.isArray(value) ? value[0] : value
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return null
}

export function extractRequestIdFromBody(body: string | null): string | null {
  if (!body) return null

  // 普通 JSON 响应：兼容成功响应、错误响应以及 Provider 自己的嵌套结构。
  const directId = parseRequestIdJson(body)
  if (directId) return directId

  // 流式响应的捕获内容是 { schemaVersion, chunks }，每个 chunk 可能包含多个 SSE event。
  try {
    const captured = JSON.parse(body) as Record<string, unknown>
    if (Array.isArray(captured.chunks)) {
      for (const chunk of captured.chunks) {
        if (typeof chunk !== 'string') continue
        const id = extractRequestIdFromSse(chunk)
        if (id) return id
      }
    }
  } catch {
    // 非 JSON body 可能仍然是原生 SSE 文本，继续按 SSE 解析。
  }

  return extractRequestIdFromSse(body)
}

function parseRequestIdJson(body: string): string | null {
  try {
    return findRequestId(JSON.parse(body))
  } catch {
    return null
  }
}

export function extractRequestIdFromSse(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const data = line.trim().replace(/^data:\s*/, '')
    if (!data || data === '[DONE]') continue
    const id = parseRequestIdJson(data)
    if (id) return id
  }
  return null
}

function findRequestId(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findRequestId(item, depth + 1)
      if (id) return id
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of ['request_id', 'requestId', 'id']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  for (const child of Object.values(record)) {
    const id = findRequestId(child, depth + 1)
    if (id) return id
  }
  return null
}
