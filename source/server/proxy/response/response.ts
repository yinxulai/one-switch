export type UpstreamStatusDisposition = 'success' | 'failover' | 'terminal'
export type HealthFailureScope = 'provider' | 'provider-model' | 'none'

export interface HealthFailureInput {
  statusCode: number | null
  responseBody?: string | null
  /**
   * 上游 2xx 但没有兼现客户端跳要求的形态（要 `http-stream` 却回了非 SSE 的整包）。
   *
   * 这个事实必须**单独告知**：状态码在这一种失败里是没有用的——`200` 落在成功区间，
   * 按状态码分类只会得到 `'none'`，于是这个模型永远不会被冷却，下一次请求依旧会选中它（§1.6.2）。
   */
  transportMismatch?: boolean
}

export function classifyUpstreamStatus(statusCode: number): UpstreamStatusDisposition {
  if (statusCode >= 200 && statusCode < 300) return 'success'
  // 上游状态码无法证明请求在其他供应商也一定无效，默认优先切换供应商。
  return 'failover'
}

export function classifyHealthFailure(input: HealthFailureInput): HealthFailureScope {
  const { statusCode, responseBody, transportMismatch } = input
  // 「没兼现要求」是**这个模型**没做到：同样的请求在别的候选上可能就能兼现，
  // 因此冷却的粒度是 provider-model，而不是整个 provider。
  if (transportMismatch) return 'provider-model'
  if (statusCode === null) return 'provider'
  if (statusCode === 401 || statusCode === 403) return 'provider'
  if (statusCode === 429) {
    const normalizedBody = responseBody?.toLowerCase() ?? ''
    const providerLimited = /(?:account|organization|project|provider|api[ _-]?key).*(?:quota|rate[ _-]?limit)|(?:quota|rate[ _-]?limit).*(?:account|organization|project|provider|api[ _-]?key)/.test(normalizedBody)
    return providerLimited ? 'provider' : 'provider-model'
  }
  if (statusCode === 404 || statusCode === 408 || statusCode >= 500) return 'provider-model'
  return 'none'
}
