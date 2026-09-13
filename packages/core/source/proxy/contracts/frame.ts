import type { HeaderMap } from './headers'

/**
 * 传输层搬运动作的最小单位。
 *
 * 写出来的是**任何传输都能归一到**的五个动作，因此新增一种传输不需要扩展这个联合。
 * 其中 `'close'` 与 `binary` 是为双向、有帧类型概念的传输留的位置：现在只有 HTTP 传输，
 * 谁都不会产生它们，但内核与修改器对它们的处理是完整的（不是未实现分支）。
 *
 * 内核只做 `upstream.frames → egress` 的搬运，不解析 `body`。唯一的解析入口是
 * `Modifier`；没有匹配的修改器时字节原样过去，这就是「零协议转换」在架构上的落地。
 */
export type Frame =
  /** 响应头 / 握手结果。HTTP 是 status + headers，WS 是 upgrade 结果。 */
  | { readonly kind: 'head', readonly status: number, readonly headers: HeaderMap }
  /** 数据。永远是字节，不做编码假设；`binary` 只在传输需要区分帧类型时才带。 */
  | { readonly kind: 'data', readonly body: Buffer, readonly binary?: boolean }
  /** 正常结束。 */
  | { readonly kind: 'end' }
  /** 传输层错误。 */
  | { readonly kind: 'error', readonly error: Error }
  /** 对端关闭（WS 的 close 帧）。 */
  | { readonly kind: 'close', readonly code?: number, readonly reason?: string }

/**
 * 数据帧携带 `binary` 的两种情形：
 * - WebSocket 必须知道一条消息原本是文本帧还是二进制帧，重编码时不能改类型；
 * - HTTP 没有这个概念，所有正文都是字节流，因此一律省略。
 *
 * 省略即按文本语义处理（HTTP 的上游响应正文原本就是文本/字节流，无帧类型可言）。
 */
export type DataFrame = Extract<Frame, { kind: 'data' }>

/** 头帧的投影（去掉 `kind`），供修改器判断「上游怎么回的」而不必自己拆联合。 */
export type HeadFrame = Extract<Frame, { kind: 'head' }>

/** 帧的消费端。内核用它与响应出口（HTTP 响应 / WS 连接）解耦。 */
export interface FrameSink {
  /** 返回是否已结束；已结束的出口不再接受后续帧。 */
  readonly closed: boolean
  write(frame: Frame): void | Promise<void>
}
