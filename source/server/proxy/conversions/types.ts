import type { Protocol } from '@common/schemas'
import type { Json } from './shared/json'

export interface StreamConverter {
  push(chunk: string): string
  flush(): string
  finish?(): string
}

export interface ProtocolTransformer {
  readonly sourceProtocol: Protocol
  readonly targetProtocol: Protocol
  convertRequest?(body: Json, model: string): Json
  convertResponse?(body: Json): Json
  createStreamConverter?(): StreamConverter
}
