import { z } from 'zod'
import type { ApiErrorCode } from '@common/schemas'

/**
 * 服务端错误码就是 §`ApiErrorCodeSchema` 那一套：
 * 渲染进程靠 `errorCode` 做本地化，所以两边不能各维护一份名单，否则新增错误码时
 * 只有一边知道，用户就会看到一句没翻译的英文原文。
 */
export type ErrorCode = ApiErrorCode

type AppErrorOptions = { expose?: boolean; cause?: unknown; details?: unknown }

export class AppError extends Error {
  readonly name = 'AppError'
  readonly expose: boolean
  readonly details?: unknown

  constructor(readonly code: ErrorCode, readonly statusCode: number, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.expose = options.expose ?? true
    this.details = options.details
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof z.ZodError) {
    return new AppError(
      'VALIDATION_ERROR',
      400,
      error.errors.map(issue => issue.message).join('; '),
      { cause: error },
    )
  }

  // 取消是调用方主动结束，不是故障，用固定的哨兵文本识别（见 proxy 执行层）。
  if (error instanceof Error && error.message === 'CLIENT_REQUEST_ABORTED') {
    return new AppError('CLIENT_REQUEST_ABORTED', 499, 'Client aborted the request', { cause: error })
  }

  return new AppError('INTERNAL_ERROR', 500, 'Internal server error', {
    expose: false,
    cause: error,
  })
}

export function getErrorResponseMessage(error: AppError, fallback: string): string {
  return error.expose ? error.message : fallback
}

/** 可安全序列化、供界面拼本地化文案的参数。 */
export type ErrorParams = Record<string, string | number>

/**
 * 从 `details` 里挑出**值本身可序列化**的字段作为 `errorParams`。
 *
 * 不做递归、不序列化对象：界面只会把参数插进一句本地化文案里，
 * 传嵌套结构没有用途，反而会把内部对象结构泄到响应体上。
 */
export function getErrorParams(error: AppError): ErrorParams | undefined {
  if (!error.expose || !error.details || typeof error.details !== 'object') return undefined
  const entries = Object.entries(error.details as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
  return entries.length > 0 ? Object.fromEntries(entries) as ErrorParams : undefined
}

export function isErrorCode(error: unknown, code: ErrorCode): boolean {
  return error instanceof AppError && error.code === code
}
