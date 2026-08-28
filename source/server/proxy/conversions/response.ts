import type { Protocol } from '@common/schemas'
import type { Json } from './shared/json'
import type { StreamConverter } from './types'
import * as anthropicToOpenAi from './anthropic-messages/to-openai-completions'
import * as responsesToOpenAi from './openai-responses/to-openai-completions'
import * as openAiToAnthropic from './openai-completions/to-anthropic-messages'

export { parseSseIncremental, serializeSseEvent } from './shared/sse'
export type { SseEvent } from './shared/sse'

interface ResponseTransformer {
  convertResponse(body: Json): Json
  createStreamConverter(): StreamConverter
}

const transformers = new Map<string, ResponseTransformer>([
  ['anthropic-messages:openai-completions', anthropicToOpenAi],
  ['openai-responses:openai-completions', responsesToOpenAi],
  ['openai-completions:anthropic-messages', openAiToAnthropic],
])

/** 非流式响应转换 */
export function convertResponseBody(clientProtocol: Protocol, endpointProtocol: Protocol, body: Buffer): Buffer {
  if (clientProtocol === endpointProtocol) return body

  const transformer = transformers.get(`${clientProtocol}:${endpointProtocol}`)
  if (!transformer) {
    throw new Error(`不支持的响应转换方向: ${endpointProtocol} -> ${clientProtocol}`)
  }

  const payload = JSON.parse(body.toString('utf8')) as Json
  const converted = transformer.convertResponse(payload)
  return Buffer.from(JSON.stringify(converted))
}

/**
 * 流式响应转换器：喂入上游 SSE 文本增量，产出下游 SSE 文本。
 */
export function createSseConverter(clientProtocol: Protocol, endpointProtocol: Protocol): StreamConverter {
  if (clientProtocol === endpointProtocol) {
    return {
      push: (chunk: string) => chunk,
      flush: () => '',
    }
  }

  const transformer = transformers.get(`${clientProtocol}:${endpointProtocol}`)
  if (!transformer) {
    throw new Error(`不支持的流式转换方向: ${endpointProtocol} -> ${clientProtocol}`)
  }

  return transformer.createStreamConverter()
}
