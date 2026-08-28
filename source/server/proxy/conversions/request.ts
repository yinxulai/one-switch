import type { Protocol } from '@common/schemas'
import type { Json } from './shared/json'
import * as anthropicToOpenAi from './anthropic-messages/to-openai-completions'
import * as responsesToOpenAi from './openai-responses/to-openai-completions'
import * as openAiToAnthropic from './openai-completions/to-anthropic-messages'

interface RequestTransformer {
  convertRequest(body: Json, model: string): Json
}

const transformers = new Map<string, RequestTransformer>([
  ['anthropic-messages:openai-completions', anthropicToOpenAi],
  ['openai-responses:openai-completions', responsesToOpenAi],
  ['openai-completions:anthropic-messages', openAiToAnthropic],
])

/**
 * 将 clientProtocol 的请求体转换为 endpointProtocol 的请求体。
 * model 字段会被替换为 ProviderModel 的远端模型名称。
 * 不支持的转换方向抛出 Error。
 */
export function convertRequestBody(clientProtocol: Protocol, endpointProtocol: Protocol, requestBody: Buffer, providerModelName: string): Buffer {
  if (clientProtocol === endpointProtocol) {
    const payload = JSON.parse(requestBody.toString('utf8')) as Json
    return Buffer.from(JSON.stringify({ ...payload, model: providerModelName }))
  }

  const transformer = transformers.get(`${clientProtocol}:${endpointProtocol}`)
  if (!transformer) {
    throw new Error(`不支持的协议转换方向: ${clientProtocol} -> ${endpointProtocol}`)
  }

  const payload = JSON.parse(requestBody.toString('utf8')) as Json
  const converted = transformer.convertRequest(payload, providerModelName)
  return Buffer.from(JSON.stringify(converted))
}
