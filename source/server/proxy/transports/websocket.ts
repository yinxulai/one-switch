import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import { getSecretStore } from '../../infrastructure/secrets/secret-store'
import { resolveWebSocketAdapter } from '../protocols/websocket-adapters/registry'
import type { WebSocketProtocolAdapter } from '../protocols/websocket-adapters/types'
import { WebSocketTurnObserver } from '../core/websocket-turn-observer'
import { createAuthHeaders } from '../core/auth'
import { createDownstreamHeaders } from '../core/headers'
import { markProviderFailure, markProviderModelFailure, markProviderModelSuccess, markProviderSuccess } from '../core/health'
import { classifyHealthFailure } from '../core/response'
import { findTransportEndpoint, type ModelWithProvider } from '../core/router'
import { resolveProxyTargets } from '../core/routing'

type UpgradeRequest = IncomingMessage & { socket: Duplex }

export interface WebSocketProxyOptions {
  logicalModelId?: string
}

export function attachWebSocketProxy(server: HttpServer, options: WebSocketProxyOptions = {}): () => void {
  const websocketServer = new WebSocketServer({ noServer: true, clientTracking: false, perMessageDeflate: true })
  const activeSockets = new Set<WebSocket>()
  const logicalModelId = options.logicalModelId ?? 'default'
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    void handleUpgrade(websocketServer, request as UpgradeRequest, socket, head, logicalModelId, activeSockets)
  }

  server.on('upgrade', onUpgrade)
  return () => {
    server.off('upgrade', onUpgrade)
    for (const activeSocket of activeSockets) {
      if (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING) activeSocket.close(1001, 'proxy stopping')
    }
    activeSockets.clear()
    websocketServer.close()
  }
}

async function handleUpgrade(websocketServer: WebSocketServer, request: UpgradeRequest, socket: Duplex, head: Buffer, logicalModelId: string, activeSockets: Set<WebSocket>): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const adapter = resolveWebSocketAdapter(request, url.pathname)
  const protocolError = adapter?.validateHandshake(request, url.pathname) ?? { statusCode: 404, code: 'UNKNOWN_API_PATH', message: '无法识别的 WebSocket API 路径' }
  if (protocolError) {
    rejectUpgrade(socket, protocolError.statusCode, protocolError.code, protocolError.message)
    return
  }

  let targets
  try {
    const resolved = await resolveProxyTargets(logicalModelId, adapter!.protocol)
    targets = resolved.targets.filter(target => Boolean(findTransportEndpoint(target.model, adapter!.protocol, 'websocket')))
  } catch (error) {
    console.error(`[proxy] WebSocket 路由失败: ${error instanceof Error ? error.message : String(error)}`)
    rejectUpgrade(socket, 503, 'WS_ROUTING_FAILED', 'WebSocket 路由失败')
    return
  }

  const target = targets[0]
  if (!target) {
    rejectUpgrade(socket, 426, 'WS_UPSTREAM_UNAVAILABLE', '没有可用的 WebSocket 上游，客户端应降级到 HTTP')
    return
  }

  const endpoint = findTransportEndpoint(target.model, adapter!.protocol, 'websocket')
  if (!endpoint) {
    rejectUpgrade(socket, 426, 'WS_UPSTREAM_UNAVAILABLE', '没有可用的 WebSocket 上游，客户端应降级到 HTTP')
    return
  }

  const upstreamUrl = toWebSocketUrl(endpoint.endpointUrl)
  const apiKey = await getSecretStore().get(target.provider.apiKeyReference)
  const upstreamHeaders: Record<string, string | string[]> = {
    ...createUpstreamWebSocketHeaders(request.headers),
    ...adapter!.createUpstreamHeaders(request),
    ...createAuthHeaders(adapter!.protocol, apiKey, endpoint.customAuthHeader),
  }
  delete upstreamHeaders.authorization
  if (apiKey) upstreamHeaders.authorization = `Bearer ${apiKey}`

  const upstream = new WebSocket(upstreamUrl, {
    headers: upstreamHeaders,
    handshakeTimeout: target.provider.timeoutMilliseconds,
    perMessageDeflate: true,
  })
  activeSockets.add(upstream)
  upstream.once('close', () => activeSockets.delete(upstream))
  const connectionId = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const startedAt = Date.now()
  let client: WebSocket | null = null
  let settled = false
  let clientBytes = 0
  let upstreamBytes = 0

  const reject = (statusCode: number, code: string, message: string) => {
    if (settled) return
    settled = true
    rejectUpgrade(socket, statusCode, code, message)
    void markWebSocketFailure(target, statusCode, message)
    console.warn(`[proxy] WebSocket 上游握手失败: connectionId=${connectionId}, providerModelId=${target.model.id}, status=${statusCode}`)
  }

  upstream.once('open', () => {
    if (settled) {
      upstream.close()
      return
    }
    settled = true
    void markProviderSuccess(target.provider.id)
    void markProviderModelSuccess(target.model.id)
    websocketServer.handleUpgrade(request, socket, head, accepted => {
      client = accepted
      activeSockets.add(accepted)
      accepted.once('close', () => activeSockets.delete(accepted))
      console.log(`[proxy] WebSocket 连接成功: connectionId=${connectionId}, providerModelId=${target.model.id}, url=${upstreamUrl}`)
      relayWebSockets(client!, upstream, target, adapter!, connectionId, startedAt, request, logicalModelId, upstreamUrl, () => clientBytes, value => { clientBytes += value }, () => upstreamBytes, value => { upstreamBytes += value })
    })
  })
  upstream.once('unexpected-response', (_request, response) => {
    const status = response.statusCode ?? 426
    reject(status, 'WS_UPSTREAM_REJECTED', `WebSocket 上游拒绝握手（HTTP ${status}）`)
  })
  upstream.once('error', error => {
    if (!settled) reject(426, 'WS_UPSTREAM_UNAVAILABLE', `WebSocket 上游连接失败：${error.message}`)
    else console.warn(`[proxy] WebSocket 上游错误: connectionId=${connectionId}, error=${error.message}`)
  })
  upstream.once('close', () => {
    if (!client || client.readyState === WebSocket.CLOSED) return
    client.close(1011, 'upstream closed')
  })
}

function relayWebSockets(client: WebSocket, upstream: WebSocket, target: ModelWithProvider, adapter: WebSocketProtocolAdapter, connectionId: string, startedAt: number, request: UpgradeRequest, logicalModelId: string, upstreamUrl: string, getClientBytes: () => number, addClientBytes: (value: number) => void, getUpstreamBytes: () => number, addUpstreamBytes: (value: number) => void): void {
  let closing = false
  let clientFrameQueue = Promise.resolve()
  const turnObserver = new WebSocketTurnObserver({ logicalModelId, protocol: adapter.protocol, path: request.url ?? '/', requestHeaders: request.headers, upstreamUrl, target })
  const closeBoth = (code: number, reason: Buffer) => {
    if (closing) return
    closing = true
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(code, reason.toString())
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close(code, reason.toString())
  }

  client.on('message', (data, isBinary) => {
    const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data))
    addClientBytes(bytes)
    if (upstream.readyState !== WebSocket.OPEN) return

    if (isBinary && !adapter.framePolicy.allowBinary) {
      closeBoth(1003, Buffer.from(adapter.framePolicy.binaryRejectionMessage))
      return
    }
    const frame = adapter.transformClientFrame(data.toString(), target.model.id)
    if (frame.ok === false) {
      closeBoth(frame.code, Buffer.from(frame.message))
      return
    }
    clientFrameQueue = clientFrameQueue
      .then(async () => {
        await turnObserver.start(frame.payload, frame.correlationKey)
        if (upstream.readyState === WebSocket.OPEN) upstream.send(frame.payload)
      })
      .catch(error => {
        console.error(`[proxy] WebSocket 客户端帧处理失败: connectionId=${connectionId}, error=${error instanceof Error ? error.message : String(error)}`)
        closeBoth(1011, Buffer.from('turn initialization failed'))
      })
  })
  upstream.on('message', (data, isBinary) => {
    const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data))
    addUpstreamBytes(bytes)
    if (!isBinary) void observeUpstreamEvent(data.toString())
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
  })
  client.once('close', (code, reason) => {
    void turnObserver.finishAll('cancelled', null)
    closeBoth(code || 1000, reason)
  })
  upstream.once('close', (code, reason) => {
    void turnObserver.finishAll('failed', 'upstream closed')
    closeBoth(code || 1011, reason)
  })
  client.once('error', () => {
    void turnObserver.finishAll('failed', 'client error')
    closeBoth(1011, Buffer.from('client error'))
  })
  upstream.once('error', () => {
    void turnObserver.finishAll('failed', 'upstream error')
    closeBoth(1011, Buffer.from('upstream error'))
  })
  const observeUpstreamEvent = async (raw: string): Promise<void> => {
    const observation = adapter.observeServerFrame(raw)
    if (observation) await turnObserver.observe(observation, raw)
  }
  const logClose = () => console.log(`[proxy] WebSocket 连接关闭: connectionId=${connectionId}, providerModelId=${target.model.id}, duration=${Date.now() - startedAt}ms, clientBytes=${getClientBytes()}, upstreamBytes=${getUpstreamBytes()}`)
  client.once('close', logClose)

}

async function markWebSocketFailure(target: ModelWithProvider, statusCode: number | null, responseBody?: string): Promise<void> {
  const scope = classifyHealthFailure(statusCode, responseBody)
  if (scope === 'provider') await markProviderFailure(target.provider.id)
  if (scope === 'provider-model') await markProviderModelFailure(target.model.id)
}

function createUpstreamWebSocketHeaders(source: IncomingMessage['headers']): Record<string, string | string[]> {
  const headers = createDownstreamHeaders(source)
  for (const name of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol']) {
    delete headers[name]
  }
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined))
}


function toWebSocketUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  else if (url.protocol === 'http:') url.protocol = 'ws:'
  else throw new Error(`Unsupported upstream URL protocol: ${url.protocol}`)
  return url.toString()
}

function rejectUpgrade(socket: Duplex, statusCode: number, errorCode: string, message: string): void {
  if (!socket.writable) return
  const body = JSON.stringify({ success: false, errorCode, errorMessage: message })
  socket.write(`HTTP/1.1 ${statusCode} ${statusText(statusCode)}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`)
  socket.destroy()
}

function statusText(statusCode: number): string {
  return statusCode === 426 ? 'Upgrade Required' : statusCode === 404 ? 'Not Found' : statusCode === 503 ? 'Service Unavailable' : 'Bad Gateway'
}
