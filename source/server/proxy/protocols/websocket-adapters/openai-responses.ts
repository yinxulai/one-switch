import type { IncomingMessage } from 'node:http'
import type { Protocol } from '@common/schemas'
import { extractResponseUsage, hasResponseOutput } from '../../core/response-pipeline'
import type { WebSocketFrameResult, WebSocketProtocolAdapter, WebSocketProtocolError, WebSocketTurnObservation } from './types'

const PATHS = new Set(['/v1/responses', '/responses'])
const OPENAI_BETA_HEADER = 'responses_websockets=2026-02-06'

export const openAIResponsesWebSocketAdapter: WebSocketProtocolAdapter = {
  protocol: 'openai-responses' as Protocol,
  framePolicy: { allowBinary: false, binaryRejectionMessage: 'Responses WebSocket requires text frames' },
  matches: (_request, pathname) => PATHS.has(pathname),
  validateHandshake(request: IncomingMessage, pathname: string): WebSocketProtocolError | null {
    if (!PATHS.has(pathname)) return { statusCode: 404, code: 'UNKNOWN_API_PATH', message: '无法识别的 WebSocket API 路径' }
    const upgrade = String(request.headers.upgrade ?? '').toLowerCase()
    const connection = String(request.headers.connection ?? '').toLowerCase()
    if (upgrade !== 'websocket' || !connection.split(',').map(value => value.trim()).includes('upgrade')) return { statusCode: 400, code: 'INVALID_WEBSOCKET_HANDSHAKE', message: '请求不是合法的 WebSocket Upgrade 握手' }
    if (!request.headers['sec-websocket-key'] || request.headers['sec-websocket-version'] !== '13') return { statusCode: 400, code: 'INVALID_WEBSOCKET_HANDSHAKE', message: '缺少合法的 WebSocket 握手头' }
    return null
  },
  createUpstreamHeaders(request: IncomingMessage): Record<string, string | string[]> {
    return { 'openai-beta': request.headers['openai-beta'] ?? OPENAI_BETA_HEADER }
  },
  transformClientFrame(raw: string, providerModelId: string): WebSocketFrameResult {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return { ok: false, code: 1002, message: 'invalid JSON frame' } }
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') return { ok: false, code: 1002, message: 'Responses event must be a JSON object' }
    const event = parsed as Record<string, unknown>
    if (event.type !== 'response.create') return { ok: false, code: 1002, message: 'unsupported Responses client event' }
    if (event.model !== undefined && typeof event.model !== 'string') return { ok: false, code: 1002, message: 'response.create model must be a string' }
    if (event.stream_id !== undefined && typeof event.stream_id !== 'string') return { ok: false, code: 1002, message: 'response.create stream_id must be a string' }
    const correlationKey = typeof event.stream_id === 'string' ? event.stream_id : undefined
    return { ok: true, payload: JSON.stringify({ ...event, model: providerModelId }), correlationKey }
  },
  observeServerFrame(raw: string): WebSocketTurnObservation | null {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return null }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const event = parsed as Record<string, unknown>
    const type = typeof event.type === 'string' ? event.type : ''
    const usage = extractResponseUsage(event)
    // Responses WebSocket echoes stream_id only for named lanes. The response
    // id identifies a response, not the client lane, so it must not be used for
    // turn routing; default-lane events intentionally fall back to FIFO.
    const correlationKey = typeof event.stream_id === 'string' ? event.stream_id : undefined
    if (type === 'response.completed' || type === 'response.incomplete') return { type: 'complete', event, raw, usage, correlationKey }
    if (type === 'response.failed' || type === 'error') return { type: 'failed', event, raw, error: raw, usage, correlationKey }
    return { type: 'event', event, raw, hasOutput: hasResponseOutput(event), usage, correlationKey }
  },
}
