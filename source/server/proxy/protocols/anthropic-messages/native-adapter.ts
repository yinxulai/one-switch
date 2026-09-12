import type { Protocol } from '@common/schemas'
import type { RequestContext } from '@server/proxy/request/request-context'
import type { NativeProtocolAdapter, StreamConverter } from '../shared/types'
import { writeJsonModel } from '../shared/json-envelope'
import { applyAnthropicMessagesRequestDefaults } from './request-defaults'

export class AnthropicMessagesNativeAdapter implements NativeProtocolAdapter {
  readonly kind = 'native' as const
  readonly clientProtocol: Protocol = 'anthropic-messages'
  readonly endpointProtocol: Protocol = 'anthropic-messages'
  readonly requiresResponseConversion = false as const

  prepareRequest(context: RequestContext, providerModelName: string): Buffer {
    return applyAnthropicMessagesRequestDefaults(
      writeJsonModel(context.requestBody, providerModelName),
    )
  }

  createStreamConverter(): null {
    return null
  }

  finishStream(_converter: StreamConverter): string {
    return ''
  }

  convertResponse(body: Buffer): Buffer {
    return body
  }
}
