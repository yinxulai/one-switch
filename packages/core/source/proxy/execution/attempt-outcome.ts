import type { Protocol } from '@common/schemas'
import type { HealthFailureScope, UpstreamStatusDisposition } from '@server/proxy/response/response'
import { classifyHealthFailure } from '@server/proxy/response/response'
import { markProviderFailure, markProviderModelFailure } from '@server/proxy/upstream/health'
import { serializeCapturedHeaders } from '@server/proxy/response/headers'
import type { UpstreamTarget } from '@server/proxy/contracts'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import type { RequestContentOutcome } from '@server/proxy/observability/logging-types'

/**
 * 一次尝试的结果。
 *
 * 这里同时装了「上游视角」与「客户端视角」两份正文，因为它们经常不是同一份东西：
 * 协议转换、响应改写之后写出去的字节与上游返回的字节完全可以不同。落库时按视角取用，
 * 不要在读取处再判断一次——读的地方判断，就一定会有人判错。
 */
export interface AttemptOutcome {
  disposition: UpstreamStatusDisposition
  statusCode: number
  durationMilliseconds: number
  errorCode?: string
  errorMessage?: string
  upstreamRequestId?: string | null
  ttftMilliseconds?: number
  /**
   * 真正发往上游的协议；只有发生了协议转换时非空。
   *
   * 仅用于日志：落库的上游协议取自尝试快照，没有这个可空语义。
   */
  upstreamProtocol?: Protocol | null
  /**
   * 上游返回的响应体原文。
   *
   * 这是「上游视角」的数据，只用于错误分类与健康度判定；写入客户端视角
   * 日志时必须使用 {@link AttemptOutcome.clientResponse}。
   */
  upstreamResponseBody?: string | null
  /**
   * 这次尝试的失败是不是「上游跳没兼现客户端跳要求的形态」（2xx 但要 `http-stream` 却回了非 SSE）。
   *
   * 健康度分类需要它：这种失败的状态码是 `200`，按状态码分类只会得到 `'none'`（§1.2）。
   */
  transportMismatch?: boolean
  /**
   * 客户端视角的最终响应；仅当响应真正写出客户端时存在。
   * failover 中途放弃、请求改写被拒等场景下为 `undefined`。
   */
  clientResponse?: ClientResponseCapture | null
}

/** 一次尝试中真正返回给客户端的内容快照。 */
export interface ClientResponseCapture {
  captureStatus: 'captured' | 'partial'
  /** 实际写出的响应头（脱敏后的 JSON 字符串）；未写出时为 `null`。 */
  responseHeaders: string | null
  /** 实际写出的响应体。 */
  responseBody: string | null
}

export function formatTarget(target: UpstreamTarget): string {
  return `${target.providerName}/${target.providerModelName} [providerId=${target.providerId}, providerModelId=${target.providerModelId}]`
}

/**
 * 序列化已经真正写出到客户端的响应头。
 *
 * 只读 `response.headers()`：响应头尚未发出时返回 `null` —— 此时根本不存在
 * 「返回给客户端的响应」，不应用上游头回退值把它伪装成已返回。
 */
export function serializeSentResponseHeaders(response: ProxyResponse): string | null {
  return serializeCapturedHeaders(response.headers())
}

/**
 * 把尝试结果中的客户端视角部分转换成请求级正文的写入入参。
 *
 * 状态码只在「响应真正写出客户端」时才回填；否则为 `null`，避免拿上游状态码
 * 冒充客户端看到的响应。
 */
export function toRequestContentOutcome(outcome: AttemptOutcome): RequestContentOutcome {
  const capture = outcome.clientResponse
  return {
    perspective: 'client',
    statusCode: capture ? outcome.statusCode : null,
    captureStatus: capture?.captureStatus ?? 'partial',
    responseHeaders: capture?.responseHeaders ?? null,
    responseBody: capture?.responseBody ?? null,
  }
}

/** 记录健康度失败，并返回这次失败影响到哪一层（供应商还是单个模型）。 */
export async function recordHealthFailure(target: UpstreamTarget, statusCode: number | null, responseBody?: string | null, transportMismatch = false): Promise<HealthFailureScope> {
  const scope = classifyHealthFailure({ statusCode, responseBody, transportMismatch })
  if (scope === 'provider') await markProviderFailure(target.providerId)
  if (scope === 'provider-model') await markProviderModelFailure(target.providerModelId)
  return scope
}
