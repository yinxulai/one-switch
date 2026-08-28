export { openAIResponsesWebSocketAdapter } from './websocket'
export { resolveWebSocketAdapter } from './registry'
export type { WebSocketProtocolAdapter, WebSocketFrameResult, WebSocketTurnObservation } from './websocket-types'

export const protocol = 'openai-responses' as const
