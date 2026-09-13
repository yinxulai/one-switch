import type { ApiResponse } from '@common/schemas'
import { getRuntimeProfile } from '@common/runtime-profile'

const API_BASE = getRuntimeProfile(import.meta.env.DEV ? 'development' : 'production').managementApiUrl

interface RequestOptions {
  signal?: AbortSignal
}

export async function request<T>(path: string, body: unknown = {}, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      // 诊断消息固定英文；界面按 `errorCode` 本地化（见 `product/i18n.md` §5）。
      return { success: false, errorCode: 'INVALID_RESPONSE', errorMessage: `management service returned a non-JSON response (HTTP ${response.status})` }
    }
    const result = (await response.json()) as ApiResponse<T>
    if (!response.ok && result.success) {
      return { success: false, errorCode: 'HTTP_ERROR', errorMessage: `management service request failed (HTTP ${response.status})` }
    }
    return result
  } catch (error) {
    return { success: false, errorCode: 'NETWORK_ERROR', errorMessage: (error as Error).message }
  }
}
