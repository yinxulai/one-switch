import type { ServerResponse } from 'node:http'
import type { RuntimeEnvironment } from '@common/runtime-profile'
import { sendError } from './response'

export function isManagementPathAllowed(pathname: string, environment: RuntimeEnvironment): boolean {
  return pathname !== '/api/development/seed' || environment === 'development'
}

export function rejectDisallowedEnvironmentPath(res: ServerResponse, pathname: string): void {
  sendError(res, 'NOT_FOUND', `API 路径不存在 ${pathname}`, 404)
}
