import type { ApiResponse } from '@common/schemas'
import { ApiRequestError } from './errors'

/**
 * 把 `{ success: false }` 响应转成异常。
 *
 * 抛出携带错误码的 `ApiRequestError` 而不是 `new Error(errorMessage)`：
 * 界面上看到的文案要按错误码本地化，英文原文只留作诊断。
 */
export async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const result = await promise
  if (!result.success) throw new ApiRequestError(result)
  return result.data
}
