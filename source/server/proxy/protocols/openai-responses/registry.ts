import type { IncomingMessage } from 'node:http'
import { openAIResponsesWebSocketAdapter } from './websocket'
import type { WebSocketProtocolAdapter } from './websocket-types'

const adapters: WebSocketProtocolAdapter[] = [openAIResponsesWebSocketAdapter]

export function resolveWebSocketAdapter(request: IncomingMessage, pathname: string): WebSocketProtocolAdapter | null {
  return adapters.find(adapter => adapter.matches(request, pathname)) ?? null
}
