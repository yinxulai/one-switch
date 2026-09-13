import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import type { HeaderMap } from '@server/proxy/contracts/headers'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const CLIENT_AUTH_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
])

const SENSITIVE_HEADERS = new Set([
  ...CLIENT_AUTH_HEADERS,
  'proxy-authorization',
  'cookie',
  'set-cookie',
])

export function redactHeaders(source: IncomingHttpHeaders | OutgoingHttpHeaders, additionalSensitiveHeaders: string[] = []): Record<string, string | string[]> {
  const sensitiveHeaders = new Set([...SENSITIVE_HEADERS, ...additionalSensitiveHeaders.map(name => name.toLowerCase())])
  return Object.fromEntries(
    Object.entries(source)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([name, value]) => [name, sensitiveHeaders.has(name.toLowerCase()) ? '[REDACTED]' : value]),
  )
}

/**
 * 把 header 对象序列化为脱敏后的 JSON 字符串，用于正文记录的 header 列。
 *
 * 空对象（例如响应头尚未写出时的 `response.headers()`）归一化为 `null`，
 * 让「没有头信息」与「从没采集过」在存储层保持一致，避免写入无意义的 `'{}'`。
 */
export function serializeCapturedHeaders(headers: IncomingHttpHeaders | OutgoingHttpHeaders | null): string | null {
  if (!headers || Object.keys(headers).length === 0) return null
  return JSON.stringify(redactHeaders(headers))
}

export function createUpstreamRequestHeaders(source: IncomingHttpHeaders, authHeaders: Record<string, string>, contentLength: number): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  const connectionHeaders = parseConnectionHeaders(source.connection)
  const replacementAuthHeaders = new Set(Object.keys(authHeaders).map(name => name.toLowerCase()))

  for (const [name, value] of Object.entries(source)) {
    const normalizedName = name.toLowerCase()
    if (value === undefined) continue
    if (normalizedName === 'host' || normalizedName === 'content-length') continue
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || connectionHeaders.has(normalizedName)) continue
    if (CLIENT_AUTH_HEADERS.has(normalizedName) || replacementAuthHeaders.has(normalizedName)) continue
    headers[name] = value
  }

  Object.assign(headers, authHeaders)
  if (contentLength > 0) headers['content-length'] = String(contentLength)
  return headers
}


export function createDownstreamHeaders(source: IncomingHttpHeaders): HeaderMap {
  const headers: HeaderMap = {}
  const connectionHeaders = parseConnectionHeaders(source.connection)

  for (const [name, value] of Object.entries(source)) {
    const normalizedName = name.toLowerCase()
    if (value === undefined) continue
    if (HOP_BY_HOP_HEADERS.has(normalizedName) || connectionHeaders.has(normalizedName)) continue
    headers[name] = value
  }

  return headers
}

function parseConnectionHeaders(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(Boolean),
  )
}
