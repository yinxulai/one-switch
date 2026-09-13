import type { ProtocolDescriptor } from '../descriptor'
import { createJsonEnvelope } from '../shared/json-envelope'
import { OpenAiCompletionsNativeAdapter, OpenAiCompletionsToAnthropicAdapter } from './adapters'

const chatEnvelope = createJsonEnvelope({ streamingField: 'stream' })
/** embeddings 没有流式概念：把流式字段声明为 `null`，而不是让内核去猜接口类型。 */
const embeddingsEnvelope = createJsonEnvelope({ streamingField: null })

export const openAiCompletionsDescriptor: ProtocolDescriptor = {
  id: 'openai-completions',
  endpoints: [
    {
      id: 'chat-completions',
      match: [
        { method: 'POST', path: '/v1/chat/completions' },
        { method: 'POST', path: '/chat/completions' },
        { method: 'POST', path: '/v1/completions' },
        { method: 'POST', path: '/completions' },
      ],
      envelope: chatEnvelope,
    },
    {
      id: 'embeddings',
      match: [
        { method: 'POST', path: '/v1/embeddings' },
        { method: 'POST', path: '/embeddings' },
      ],
      envelope: embeddingsEnvelope,
    },
  ],
  createAdapters: () => [
    new OpenAiCompletionsNativeAdapter(),
    new OpenAiCompletionsToAnthropicAdapter(),
  ],
}
