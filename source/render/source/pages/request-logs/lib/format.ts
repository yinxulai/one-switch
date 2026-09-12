import type { RequestLogEntryAttempt } from '@common/schemas'

export const PROTOCOL_LABEL: Record<string, string> = {
  'openai-responses': 'OpenAI Responses',
  'openai-completions': 'OpenAI Completions',
  'anthropic-messages': 'Anthropic Messages',
}

export const STATUS_LABEL: Record<string, string> = {
  pending: '进行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
}

/**
 * 传输形态的展示标签。
 *
 * 一根轴三个取值，不需要再做任何组合推断：`http` 是整包收送，`http-stream` 是增量收送。
 * 加一个 `websocket` 只为让「声明了但没实现」在界面上也读得懂。
 */
export const TRANSPORT_LABEL: Record<string, string> = {
  'http': '整包',
  'http-stream': '增量',
  websocket: 'WebSocket',
}

export function formatTransport(transport: string | null | undefined): string {
  if (transport == null) return '未知'
  return TRANSPORT_LABEL[transport] ?? transport
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTTFT(ttftMs: number | null | undefined): string {
  if (ttftMs == null) return '—'
  return `${(ttftMs / 1000).toFixed(2)}s`
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function formatTPS(outputTokens: number | null | undefined, totalMs: number): string {
  if (outputTokens == null || outputTokens <= 0 || totalMs <= 0) return '—'
  const tps = (outputTokens / totalMs) * 1000
  return tps >= 10 ? `${Math.round(tps)}` : tps.toFixed(1)
}

/**
 * 一次尝试的结果标签。
 *
 * HTTP 状态就是结果本身：有状态码时「失败」「可重试」这类词都只是它的同义反复；
 * 没有状态码才说明上游一个字节都没回。
 */
export function formatAttemptOutcome(attempt: RequestLogEntryAttempt): string {
  return attempt.httpStatus === null ? '未收到响应' : `HTTP ${attempt.httpStatus}`
}

/**
 * 只保留真正独立的错误码。
 *
 * 上游 HTTP 非 2xx 时落库的 `Status_401` 是 HTTP 状态的副本，与结果标签完全重复；
 * 只有像 `UPSTREAM_TIMEOUT` 这种在状态码之外另有信息量的错误码才值得单独展示。
 */
export function distinctAttemptErrorCode(attempt: RequestLogEntryAttempt): string | null {
  if (!attempt.errorCode) return null
  if (attempt.httpStatus !== null && attempt.errorCode === `Status_${attempt.httpStatus}`) return null
  return attempt.errorCode
}

/**
 * 只保留真正补充了信息的错误信息。
 *
 * 上游非 2xx 时落库的「上游返回 401」与结果标签 `HTTP 401` 完全同义，
 * 展示它等于把同一个事实说第二遍；只有 TLS 断开这类额外说明才值得占一行。
 */
export function distinctAttemptErrorMessage(attempt: RequestLogEntryAttempt): string | null {
  if (!attempt.errorMessage) return null
  const restatesStatus = attempt.httpStatus !== null
    && attempt.errorMessage.trim() === `上游返回 ${attempt.httpStatus}`
  return restatesStatus ? null : attempt.errorMessage
}
