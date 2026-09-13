import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiErrorCode } from '@common/schemas'
import { getErrorParams, getErrorResponseMessage, normalizeError, type ErrorParams } from '../../errors'

export type ManagementHandler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void> | void

export function sendSuccess(res: ServerResponse, data: unknown): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: true, data }))
}

/**
 * 错误文案**一律英文**：管理 API 是本地服务，但它的响应会被日志、测试与外部工具读到，
 * 不该跟界面语言绑死。界面按 `errorCode` 自己本地化，`errorParams` 只提供插值所需的原值。
 */
export function sendError(res: ServerResponse, errorCode: ApiErrorCode, errorMessage: string, statusCode = 400, errorParams?: ErrorParams): void {
  if (res.writableEnded) return
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ success: false, errorCode, errorMessage, ...(errorParams ? { errorParams } : {}) }))
}

export function sendManagementError(res: ServerResponse, error: unknown): void {
  const normalized = normalizeError(error)
  sendError(
    res,
    normalized.code,
    getErrorResponseMessage(normalized, 'Internal server error'),
    normalized.statusCode,
    getErrorParams(normalized),
  )
}
