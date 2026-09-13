import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RouteMatcher } from './route-matcher'

export interface LocalHandlerInput {
  readonly request: IncomingMessage
  readonly response: ServerResponse
}

/**
 * 本地处理器：由代理自己直接应答、不转发上游的入口。
 *
 * 入口匹配统一走注册表，所以本地处理器可以是任意方法与任意路径，不需要在请求入口里
 * 写 `if (pathname === '/v1/models')`。等内核的 Exchange/EgressWriter 落地后，
 * `handle` 的入参会换成交换与出口投影，调用方无需改动。
 */
export interface LocalHandler {
  readonly id: string
  readonly match: readonly RouteMatcher[]
  handle(input: LocalHandlerInput): void | Promise<void>
}
