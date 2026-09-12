import type { AppTranslator } from '@/i18n/provider'

export interface FormattedContent {
  value: string
  isJson: boolean
}

interface CapturedStreamingBody {
  schemaVersion?: unknown
  chunks?: unknown
}

interface LocalFailureBody {
  localFailure?: unknown
  errorCode?: unknown
  errorMessage?: unknown
}

/** 本地失败的上游视角响应：连接被拒、超时这类情况下游一个字节都没回。 */
export function isLocalFailureBody(value: string | null): boolean {
  if (!value) return false
  try {
    return (JSON.parse(value) as LocalFailureBody).localFailure === true
  } catch {
    return false
  }
}

export function formatContent(t: AppTranslator, value: string): FormattedContent {
  try {
    const parsed = JSON.parse(value) as CapturedStreamingBody & LocalFailureBody
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.chunks) && parsed.chunks.every(chunk => typeof chunk === 'string')) {
      return { value: parsed.chunks.join(''), isJson: true }
    }
    // 本地失败的「响应」不是上游报文，而是一句失败原因。按 JSON 展开会把它埋进键值对里，
    // 而「为什么失败」恰恰是这次请求唯一需要回答的问题。
    if (parsed.localFailure === true) {
      const message = typeof parsed.errorMessage === 'string' ? parsed.errorMessage : t('requestLogs.contents.unknownReason')
      const code = typeof parsed.errorCode === 'string' ? t('requestLogs.contents.errorCodeSuffix', { code: parsed.errorCode }) : ''
      return { value: t('requestLogs.contents.localFailureWithMessage', { message, code }), isJson: false }
    }
    return { value: JSON.stringify(parsed, null, 2), isJson: true }
  } catch {
    return { value, isJson: false }
  }
}
