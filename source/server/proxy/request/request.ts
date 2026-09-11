export function resolveUpstreamUrl(upstreamUrl: string): string {
  const parsed = new URL(upstreamUrl)

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported upstream URL protocol: ${parsed.protocol}`)
  }

  return parsed.toString()
}

export function validateLogicalModel(requestBody: Buffer): string | null {
  let payload: unknown
  try {
    payload = JSON.parse(requestBody.toString('utf8'))
  } catch {
    return '请求体必须是 JSON 对象'
  }
  if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
    return '请求体必须是 JSON 对象'
  }
  const model = (payload as Record<string, unknown>).model
  if (model === undefined) return '缺少 model 字段'
  if (typeof model !== 'string' || model.trim().length === 0) return 'model 必须为非空字符串'
  return null
}

export function rewriteRequestModel(requestBody: Buffer, providerModelName: string): Buffer {
  if (requestBody.length === 0) return requestBody

  try {
    const payload: unknown = JSON.parse(requestBody.toString('utf8'))
    if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
      throw new Error('Request body must be a JSON object')
    }

    return Buffer.from(JSON.stringify({ ...payload, model: providerModelName }))
  } catch (error) {
    if (error instanceof Error && error.message === 'Request body must be a JSON object') {
      throw error
    }
    throw new Error('Request body must be a JSON object', { cause: error })
  }
}

/**
 * 客户端是否要求流式响应。
 *
 * 这是**请求级**事实：一个请求里的所有尝试共用它，写在 `request_logs.streaming`。
 * 尝试级事实是「上游是否以 SSE 返回」，只有拿到响应头之后才存在，两者不可混用。
 */
export function isStreamingRequest(requestBody: Buffer): boolean {
  try {
    const payload: unknown = JSON.parse(requestBody.toString('utf8'))
    if (payload === null || Array.isArray(payload) || typeof payload !== 'object') return false
    return (payload as Record<string, unknown>).stream === true
  } catch {
    return false
  }
}
