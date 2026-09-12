import type { ProtocolDescriptor } from '../descriptor'
import { createJsonEnvelope } from '../shared/json-envelope'
import { AnthropicMessagesNativeAdapter, AnthropicMessagesToOpenAiCompletionsAdapter } from './adapters'

export const anthropicMessagesDescriptor: ProtocolDescriptor = {
  id: 'anthropic-messages',
  endpoints: [
    {
      id: 'messages',
      match: [
        { method: 'POST', path: '/v1/messages' },
        { method: 'POST', path: '/messages' },
      ],
      envelope: createJsonEnvelope({ streamingField: 'stream' }),
    },
  ],
  createAdapters: () => [
    new AnthropicMessagesNativeAdapter(),
    new AnthropicMessagesToOpenAiCompletionsAdapter(),
  ],
}
