import type { Protocol, TransportKind } from '@common/schemas'
import type { HeaderMap } from './headers'

/**
 * 传输 / 修改器 / 观察者能看到的交换投影。
 *
 * 刻意只包含「转发一条请求必需的事实」，不含任何可变响应状态：这些组件都不认识
 * 观察点落库、不认识日志表结构。凭据也不在这里——认证由 auth 修改器在进入传输前注入，
 * 传输与观察者全程接触不到密钥。
 */
export interface ExchangeView {
  readonly requestId: string
  readonly logicalModelId: string
  /**
   * 客户端侧协议。
   *
   * 与下面的 `transport` 构成入口侧的一对：完整形态是
   * `入口(协议, 传输) → 出口(协议, 传输)`，中间只做协议到协议的转换。
   * 两者不能合成一个字段——`protocol` 决定「报文怎么读」，`transport` 决定「线上的字节长什么样」，
   * 同一协议在两种传输上的报文可以一致、握手与分帧却不同。
   */
  readonly clientProtocol: Protocol
  /**
   * **客户端跳**的传输形态。入口从接口封装描述里读出来，是请求级事实。
   *
   * 它只是客户端跳的事实，与上游跳无关：上游用哪种形态由那个端点的**地址**决定
   * （`wss://` 是 WebSocket，其余地址上我们忠实转发），规划器与传输注册表一起把它定下来。
   */
  readonly transport: TransportKind
  readonly method: string
  readonly path: string
  readonly headers: HeaderMap
  /** 已由请求侧修改器处理完、可以原样发出去的字节。 */
  readonly body: Buffer
  readonly signal: AbortSignal
}

/** 传输 / 修改器 / 观察者能看到的尝试投影。 */
export interface AttemptView {
  readonly index: number
  readonly endpointId: string
  readonly endpointProtocol: Protocol
}
