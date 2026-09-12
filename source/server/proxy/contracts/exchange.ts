import type { Protocol } from '@common/schemas'
import type { DeliveryMode } from './delivery'
import type { HeaderMap } from './headers'
import type { TransportKind } from './transport'

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
   * 与下面的 `transport` 构成入口侧的一对：完整形态是 `入口(协议, 传输) → 出口(协议, 传输)`，
   * 中间只做协议到协议的转换。两者不能合成一个字段——`protocol` 决定「报文怎么读」，
   * `transport` 决定「字节怎么运」，同一协议在两种传输上的报文可以一致、握手与分帧却不同。
   */
  readonly clientProtocol: Protocol
  /**
   * 客户端侧传输。
   *
   * 今天两端都只有 `'http'`（另一种载体尚未实现），但依然显式写下来：不写就没人能
   * 区分「两条路一样」与「还没实现另一条路」。出口传输取自 `UpstreamTarget`，入口传输取自
   * 这里，两者显式对比才能让将来的双向往返变成一个可改的决定而不是一个假设。
   */
  readonly transport: TransportKind
  readonly method: string
  readonly path: string
  readonly headers: HeaderMap
  /** 已由请求侧修改器处理完、可以原样发出去的字节。 */
  readonly body: Buffer
  /**
   * 客户端要求的交付方式，入口按接口封装描述解析一次。
   *
   * 这是「客户端意图」，不是上游事实——上游是否真的逐块回由响应头决定。
   * 出口要不要边收边发同时看这两者（`isStreamingDelivery`），任何一侧都不足以决定。
   */
  readonly delivery: DeliveryMode
  readonly signal: AbortSignal
}

/** 传输 / 修改器 / 观察者能看到的尝试投影。 */
export interface AttemptView {
  readonly index: number
  readonly endpointId: string
  readonly endpointProtocol: Protocol
}
