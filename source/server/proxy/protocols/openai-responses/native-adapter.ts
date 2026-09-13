import type { Protocol } from '@common/schemas'
import type { RequestContext } from '@server/proxy/request/request-context'
import type { NativeProtocolAdapter, StreamConverter } from '../shared/types'
import { writeJsonModel } from '../shared/json-envelope'

export class OpenAiResponsesNativeAdapter implements NativeProtocolAdapter {
  readonly kind = 'native' as const
  readonly clientProtocol: Protocol = 'openai-responses'
  readonly endpointProtocol: Protocol = 'openai-responses'
  readonly requiresResponseConversion = false as const

  prepareRequest(context: RequestContext, providerModelName: string): Buffer {
    // native responses 请求必须被原样保留：只改写模型名，不注入 stream_options 之类的
    // OpenAI-completions 专有默认值，否则上游会拒绝这条原生请求。
    return writeJsonModel(context.requestBody, providerModelName)
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
