import type { Protocol } from '@common/schemas'
import type { Frame, HeadFrame } from './frame'
import type { HeaderMap } from './headers'
import type { AttemptView, ExchangeView } from './exchange'
import type { TransportKind } from './transport'

/** 修改器作用的方向。 */
export type ModifierDirection = 'request' | 'response'

/**
 * 修改器需要看到的粒度。
 * - `buffered`：拿到完整体（模型改写、认证注入、转换请求体）
 * - `frame`：逐帧（SSE 转换、逐块观测）
 * - `skip`：本次交换里不参与。与「`match` 返回 false」的区别是声明性的：这里说的是
 *   「这个修改器在某种交换形态下没有意义」，而 `match` 说的是「这一条不满足条件」。
 *   两个管道都只筛自己那两种粒度，因此不加它也能跑，但没有它就只能用 `match` 回一个恒 
 *   `false` 来表达「不适用」，那会让「为什么没生效」看起来像配置问题。
 */
export type ModifierFrameMode = 'buffered' | 'frame' | 'skip'

/** 缓冲区载荷。`headers` 可原地改写，返回 null 表示丢弃该次交换。 */
export interface BufferedPayload {
  body: Buffer
  headers: HeaderMap
}

export interface ModifierContext {
  readonly exchange: ExchangeView
  readonly attempt: AttemptView
  readonly direction: ModifierDirection
  readonly clientProtocol: Protocol
  readonly upstreamProtocol: Protocol
  /**
   * 客户端侧传输，与 `exchange.transport` 同值，放在这里是为了让 `match` 与 `apply*`
   * 不必先解构 `exchange` 才能判断「这个修改器在当前传输上是否成立」。
   */
  readonly transport: TransportKind
  /**
   * 上游响应头投影；尚未收到响应头时为 `null`。
   *
   * 修改器判断自己该不该介入往往只取决于响应头（例如「上游是不是用 SSE 返回」），
   * 而 `match()` 拿不到帧，因此把这份事实放进上下文。这里始终是上游的原始头，
   * 不会被任何修改器改写。
   */
  readonly upstreamHead: HeadFrame | null
}

/**
 * 修改器：内核里唯一允许解析、改写报文的地方。
 *
 * 内核按 `direction` 收集匹配的修改器，`buffered` 与 `frame` 分两段执行：
 * 缓冲区修改器全部跑完才发出去（顺序由 `order` 决定），帧修改器按 `order` 串成管道。
 * 同一个修改器可以只实现一个方向、也可以两个都实现（例如协议转换）。
 */
export interface Modifier {
  readonly id: string
  /** 越小越先执行；同值时按注册顺序。 */
  readonly order: number
  readonly direction: ModifierDirection
  readonly frameMode: ModifierFrameMode
  match(context: ModifierContext): boolean
  applyBuffered?(context: ModifierContext, payload: BufferedPayload): BufferedPayload | null | Promise<BufferedPayload | null>
  applyFrame?(context: ModifierContext, frame: Frame): Frame | readonly Frame[] | null | Promise<Frame | readonly Frame[] | null>
}
