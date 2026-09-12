import type { ServerResponse } from 'node:http'
import { sendError } from './response'

export async function applyManagementRequestGuards(method: string | undefined, url: string | undefined, res: ServerResponse): Promise<boolean> {
  setCorsHeaders(res)

  if (method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return false
  }

  const pathname = new URL(url!, 'http://localhost').pathname
  if (!pathname.startsWith('/api/')) {
    sendError(res, 'RESOURCE_NOT_FOUND', `Management API path not found: ${pathname}`, 404, { path: pathname })
    return false
  }
  if (method !== 'POST') {
    sendError(res, 'METHOD_NOT_ALLOWED', `Only POST is supported, received ${method ?? 'UNKNOWN'}`, 405, { method: method ?? 'UNKNOWN' })
    return false
  }
  return true
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}
