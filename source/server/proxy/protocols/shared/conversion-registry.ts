import type { Protocol } from '@common/schemas'
import { anthropicToOpenAiRequest } from './request-conversion-anthropic-to-openai'
import { responsesToOpenAiRequest } from './request-conversion-responses-to-openai'
import { openAiToAnthropicRequest } from './request-conversion-openai-to-anthropic'
import {
  createOpenAiToAnthropicState,
  finishOpenAiToAnthropic,
  openAiChunkToAnthropicEvents,
  openAiResponseToAnthropic,
} from './response-conversion-openai-to-anthropic'
import {
  createOpenAiToResponsesState,
  finishOpenAiToResponses,
  openAiChunkToResponsesEvents,
  openAiResponseToResponses,
} from './response-conversion-openai-to-responses'
import {
  anthropicEventToOpenAiChunks,
  anthropicResponseToOpenAi,
  createAnthropicToOpenAiState,
  finishAnthropicToOpenAiChunks,
} from './response-conversion-anthropic-to-openai'

/**
 * 协议转换方向注册表。
 *
 * 收敛目标：方向判断（`if (client === ... && endpoint === ...)`）不再散落在
 * `request-conversion.ts` / `response-conversion.ts` 里，而是每方向**声明一次**。
 * 新增一个方向 = 在下面两张表里各加一行，不动任何流程代码。
 *
 * 两张表分开的原因：请求方向按「客户端协议 → 上游协议」索引，响应方向按
 * 「上游协议 → 客户端协议」索引，二者恰好相反，混在一张表里只会制造二次判断。
 */

type Json = Record<string, unknown>

/** 某个方向的请求体转换。 */
interface RequestDirection {
  convert(payload: Json, providerModelName: string): Json
}

/** 某个方向的 SSE 逐事件转换器。状态由实现自己持有（闭包），调用方只看到载荷与事件。 */
interface SseDirection {
  push(payload: Json): Json[]
  finish(): Json[]
}

/** 某个方向的响应转换：非流式整体转换 + 流式逐事件转换。 */
interface ResponseDirection {
  convert(payload: Json): Json
  createSseConverter(): SseDirection
}

function directionKey(from: Protocol, to: Protocol): string {
  return `${from}->${to}`
}

const requestDirections = new Map<string, RequestDirection>([
  [directionKey('anthropic-messages', 'openai-completions'), {
    convert: (payload, providerModelName) => anthropicToOpenAiRequest(payload as never, providerModelName) as unknown as Json,
  }],
  [directionKey('openai-responses', 'openai-completions'), {
    convert: (payload, providerModelName) => responsesToOpenAiRequest(payload as never, providerModelName) as unknown as Json,
  }],
  [directionKey('openai-completions', 'anthropic-messages'), {
    convert: (payload, providerModelName) => openAiToAnthropicRequest(payload as never, providerModelName) as unknown as Json,
  }],
])

const responseDirections = new Map<string, ResponseDirection>([
  [directionKey('openai-completions', 'anthropic-messages'), {
    convert: payload => openAiResponseToAnthropic(payload) as unknown as Json,
    createSseConverter: () => {
      const state = createOpenAiToAnthropicState()
      return {
        push: payload => openAiChunkToAnthropicEvents(payload, state) as unknown as Json[],
        finish: () => finishOpenAiToAnthropic(state) as unknown as Json[],
      }
    },
  }],
  [directionKey('openai-completions', 'openai-responses'), {
    convert: payload => openAiResponseToResponses(payload) as unknown as Json,
    createSseConverter: () => {
      const state = createOpenAiToResponsesState()
      return {
        push: payload => openAiChunkToResponsesEvents(payload, state) as unknown as Json[],
        finish: () => finishOpenAiToResponses(state) as unknown as Json[],
      }
    },
  }],
  [directionKey('anthropic-messages', 'openai-completions'), {
    convert: payload => anthropicResponseToOpenAi(payload) as unknown as Json,
    createSseConverter: () => {
      const state = createAnthropicToOpenAiState()
      return {
        push: payload => anthropicEventToOpenAiChunks(payload, state) as unknown as Json[],
        finish: () => finishAnthropicToOpenAiChunks(state) as unknown as Json[],
      }
    },
  }],
])

export function findRequestDirection(clientProtocol: Protocol, endpointProtocol: Protocol): RequestDirection | undefined {
  return requestDirections.get(directionKey(clientProtocol, endpointProtocol))
}

export function findResponseDirection(endpointProtocol: Protocol, clientProtocol: Protocol): ResponseDirection | undefined {
  return responseDirections.get(directionKey(endpointProtocol, clientProtocol))
}

/** 声明出来的全部方向，供测试断言「声明数 ⇔ 可解析数」一致。 */
export function listConversionDirections(): readonly { from: Protocol, to: Protocol }[] {
  return [...requestDirections.keys()].map(key => {
    const [from, to] = key.split('->') as [Protocol, Protocol]
    return { from, to }
  })
}
