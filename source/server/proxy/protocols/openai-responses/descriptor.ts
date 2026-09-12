import type { ProtocolDescriptor } from '../descriptor'
import { createJsonEnvelope } from '../shared/json-envelope'
import { OpenAiResponsesNativeAdapter, OpenAiResponsesToOpenAiCompletionsAdapter } from './adapters'

export const openAiResponsesDescriptor: ProtocolDescriptor = {
  id: 'openai-responses',
  endpoints: [
    {
      // `match` 上的 `transport` 现在只有 `'http'` 一个取值，写它是为了避免依赖「没写即所有已声明封装都适用」
      // 这个隐式规则：将来这个接口真的多出一种传输（同一份语义、另一种载体）时，这里多一条匹配即可，
      // 接口 id 不变——把传输写进 id（`responses-websocket`）会让同一种语义在两个地方各说一通。
      id: 'responses',
      match: [
        { method: 'POST', path: '/v1/responses', transport: 'http' },
        { method: 'POST', path: '/responses', transport: 'http' },
      ],
      envelopes: { http: createJsonEnvelope({ streamingField: 'stream' }) },
    },
  ],
  createAdapters: () => [
    new OpenAiResponsesNativeAdapter(),
    new OpenAiResponsesToOpenAiCompletionsAdapter(),
  ],
}
