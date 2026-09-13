import type { RequestLogEntryAttempt } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { AppTranslator } from '@/i18n/provider'

export const PROTOCOL_LABEL: Record<string, string> = {
  'openai-responses': 'OpenAI Responses',
  'openai-completions': 'OpenAI Completions',
  'anthropic-messages': 'Anthropic Messages',
}

/** 状态只存文案 key：同一枚徽标在两种界面语言下都要读得通。 */
export const STATUS_LABEL_KEY: Record<string, UiCatalogKey> = {
  pending: 'requestLogs.status.pending',
  success: 'requestLogs.status.success',
  failed: 'requestLogs.status.failed',
  cancelled: 'requestLogs.status.cancelled',
}

/** 未知状态不回退成某一种语言，直接原样展示取值本身。 */
export function formatStatus(t: AppTranslator, status: string): string {
  const key = STATUS_LABEL_KEY[status]
  return key ? t(key) : status
}

/**
 * 传输形态的展示标签。
 *
 * 一根轴三个取值，不需要再做任何组合推断：`http` 是整包收送，`http-stream` 是增量收送。
 * 加一个 `websocket` 只为让「声明了但没实现」在界面上也读得懂。
 */
export const TRANSPORT_LABEL_KEY: Record<string, UiCatalogKey> = {
  'http': 'requestLogs.transport.http',
  'http-stream': 'requestLogs.transport.httpStream',
  websocket: 'requestLogs.transport.websocket',
}

export function formatTransport(t: AppTranslator, transport: string | null | undefined): string {
  if (transport == null) return t('common.state.unknown')
  const key = TRANSPORT_LABEL_KEY[transport]
  return key ? t(key) : transport
}

/** 时间要按界面语言格式化，不能用运行时默认语言。 */
export function formatTime(locale: string, ts: number): string {
  return new Date(ts).toLocaleTimeString(locale, { hour12: false })
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
export function formatAttemptOutcome(t: AppTranslator, attempt: RequestLogEntryAttempt): string {
  return attempt.httpStatus === null ? t('requestLogs.attempt.noResponse') : `HTTP ${attempt.httpStatus}`
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
 * 上游非 2xx 时落库的错误信息只是状态码的自然语言副本，展示它等于把同一个事实说第二遍；
 * 只有 TLS 断开这类额外说明才值得占一行。判据取错误码而不是文案：文案是服务端诊断，
 * 按 `product/i18n.md` §5 保持英文而不做本地化，界面不能反过来依赖它的措辞。
 */
export function distinctAttemptErrorMessage(attempt: RequestLogEntryAttempt): string | null {
  if (!attempt.errorMessage) return null
  const restatesStatus = attempt.httpStatus !== null
    && attempt.errorCode === `Status_${attempt.httpStatus}`
  return restatesStatus ? null : attempt.errorMessage
}
