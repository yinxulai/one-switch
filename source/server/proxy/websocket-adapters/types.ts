import type { IncomingMessage } from 'node:http'
import type { Protocol } from '@common/schemas'
import type { ExtractedUsage } from '../response-pipeline'

export interface WebSocketFramePolicy {
  allowBinary: boolean
  binaryRejectionMessage: string
}

export interface WebSocketProtocolError {
  statusCode: number
  code: string
  message: string
}

export type WebSocketFrameResult = {
  ok: true
  payload: string
  correlationKey?: string
} | {
  ok: false
  code: number
  message: string
}

export interface WebSocketTurnObservation {
  type: 'event' | 'complete' | 'failed'
  event?: Record<string, unknown>
  raw?: string
  error?: string
  hasOutput?: boolean
  usage?: ExtractedUsage
  correlationKey?: string
}

export interface WebSocketProtocolAdapter {
  readonly protocol: Protocol
  readonly framePolicy: WebSocketFramePolicy
  matches(request: IncomingMessage, pathname: string): boolean
  validateHandshake(request: IncomingMessage, pathname: string): WebSocketProtocolError | null
  createUpstreamHeaders(request: IncomingMessage): Record<string, string | string[]>
  transformClientFrame(raw: string, providerModelId: string): WebSocketFrameResult
  observeServerFrame(raw: string): WebSocketTurnObservation | null
}
