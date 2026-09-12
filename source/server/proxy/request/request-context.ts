import type { IncomingHttpHeaders } from 'node:http'
import type { Protocol, RequestAttribute } from '@common/schemas'
import type { DeliveryMode, TransportKind } from '@server/proxy/contracts'

export interface RequestContext {
  readonly requestId: string
  readonly logicalModelId: string
  readonly clientProtocol: Protocol
  /**
   * 客户端侧传输。
   *
   * 与 `clientProtocol` 并列而不是合并：`clientProtocol` 决定「报文怎么读」，传输决定
   * 「字节怎么运」。入口解析一次，整条请求链（交换投影、修改器上下文）共用它。
   */
  readonly transport: TransportKind
  readonly method: string
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly attributes: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  readonly requestBody: Buffer
  /**
   * 客户端要求的交付方式。
   *
   * 这是**请求级**事实：入口按接口的封装描述解析一次，一个请求里的所有尝试共用它，
   * 写入 `request_logs.streaming`（布尔列，写入点从轴上投影）。尝试级事实是
   * 「上游是否以 SSE 返回」，只有拿到响应头之后才存在，两者不可混用。
   */
  readonly delivery: DeliveryMode
  readonly signal: AbortSignal
}

export type RequestContextInput = Omit<RequestContext, 'signal' | 'headers' | 'attributes' | 'delivery' | 'transport'> & {
  headers?: IncomingHttpHeaders
  attributes?: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  delivery?: DeliveryMode
  signal?: AbortSignal
  /** 省略即 `http`：不以传输为卖点的调用方（模型连通性探测、能力自检）都是 HTTP 形状的。 */
  transport?: TransportKind
}

export function createRequestContext(input: RequestContextInput): RequestContext {
  return {
    ...input,
    headers: input.headers ?? {},
    attributes: input.attributes ?? [],
    delivery: input.delivery ?? 'buffered',
    transport: input.transport ?? 'http',
    signal: input.signal ?? new AbortController().signal,
  }
}
