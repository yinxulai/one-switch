import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HttpMethod } from '@server/http-router'

/** 本地端点的单次调用输入。 */
export interface LocalEndpointInput {
  readonly request: IncomingMessage
  readonly response: ServerResponse
}

/**
 * 本地端点：由代理自己直接应答、不转发到上游的入口。
 *
 * 存在的意义是把「哪些路径由代理自己处理」从 `runtime/proxy-runtime.ts` 的
 * `if (url.pathname === ...)` 里挪出来，变成和协议入口一样的**数据声明**：
 *
 * - 入口匹配统一走注册表，因此本地端点可以是任意方法（`GET /v1/models`
 *   与将来可能的 `POST` 本地端点共用同一个匹配器，见 §1.7）；
 * - runtime 只保留「生命周期 + 边界错误处理」，不再知道任何具体路径；
 * - 新增本地端点只需在 `localEndpoints` 数组里加一条，不触碰 runtime。
 */
export interface LocalEndpoint {
  readonly method: HttpMethod
  /** 入口路径。入口匹配器会归一化查询串与首尾多余斜杠。 */
  readonly path: string
  /** 处理该入口。实现负责设置状态码、响应头并结束响应，不向内核返回任何值。 */
  handle(input: LocalEndpointInput): void | Promise<void>
}
