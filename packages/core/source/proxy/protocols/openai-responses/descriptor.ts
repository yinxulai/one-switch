import type { ProtocolDescriptor } from '../descriptor'
import { createJsonEnvelope } from '../shared/json-envelope'
import { OpenAiResponsesNativeAdapter, OpenAiResponsesToOpenAiCompletionsAdapter } from './adapters'

export const openAiResponsesDescriptor: ProtocolDescriptor = {
  id: 'openai-responses',
  endpoints: [
    {
      id: 'responses',
      match: [
        { method: 'POST', path: '/v1/responses' },
        { method: 'POST', path: '/responses' },
      ],
      envelope: createJsonEnvelope({ streamingField: 'stream' }),
    },
  ],
  createAdapters: () => [
    new OpenAiResponsesNativeAdapter(),
    new OpenAiResponsesToOpenAiCompletionsAdapter(),
  ],
}
