import type { IncomingHttpHeaders } from 'node:http'
import type { Protocol, RequestAttribute, TransportKind } from '@common/schemas'

export interface RequestContext {
  readonly requestId: string
  readonly logicalModelId: string
  readonly clientProtocol: Protocol
  /**
   * **客户端跳**的传输形态。**事实**：入口按接口封装描述解析出来，一个请求只解析一次。
   *
   * 与 `clientProtocol` 并列而不是合并：`clientProtocol` 决定「报文怎么读」，
   * 传输形态决定「线上的字节长什么样」。整条请求链（交换投影、修改器上下文）共用它。
   *
   * 它与上游跳无关：上游用哪种形态由那个端点的地址决定，客户端说要 WebSocket 也改变不了
   * 一个 `https://` 端点。把客户端的取值传下去当上游取值用，就是 §2.3.1 那条被删掉的耦合链。
   */
  readonly transport: TransportKind
  readonly method: string
  readonly path: string
  readonly headers: IncomingHttpHeaders
  readonly attributes: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  readonly requestBody: Buffer
  readonly signal: AbortSignal
}

export type RequestContextInput = Omit<RequestContext, 'signal' | 'headers' | 'attributes' | 'transport'> & {
  headers?: IncomingHttpHeaders
  attributes?: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  signal?: AbortSignal
  /** 省略即 `http`：不以形态为卖点的调用方（模型连通性探测、能力自检）都是一问一答形状的。 */
  transport?: TransportKind
}

export function createRequestContext(input: RequestContextInput): RequestContext {
  return {
    ...input,
    headers: input.headers ?? {},
    attributes: input.attributes ?? [],
    transport: input.transport ?? 'http',
    signal: input.signal ?? new AbortController().signal,
  }
}
