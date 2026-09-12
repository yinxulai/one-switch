import type { Protocol, TransportKind } from '@common/schemas'
import type { Frame, FrameSink } from './frame'
import type { AttemptView, ExchangeView } from './exchange'

/**
 * 传输：一次交换在**一跳**上长什么样。
 *
 * 词表定义在 `@common/schemas`，与工作流层（`@common/router`）同源：两层各写一份枚举迟早
 * 会漂移出「上层说有、下层不认」的取值。这里只负责把它转出给代理层使用。
 *
 * 代理层里两跳各自有一个形态：客户端跳是 `ExchangeView.transport`（入口写下的**事实**），
 * 上游跳由端点的**地址**与客户端跳的形态一起定下来（`wss://` 是 WebSocket；其余地址上我们
 * 忠实转发，发出去什么形态，上游就按什么形态回），因此不需要在上游目标上再存一份。
 *
 * 现在只有 `http` / `http-stream` 有实现（同一个 HTTP 实现服务两者）；`'websocket'` 是
 * **已声明但未实现**的取值（见 `transports/registry.ts`）。
 * 新增一种传输 = 扩展共享词表 + 在 `transports/` 下加一个 `Transport` 实现 + 在注册表里加一个分支。
 */
export type { TransportKind }

/** 一次尝试要连到哪里。由 `AttemptPlanner` 产出，执行器不再自己拼 URL 或查端点。 */
export interface UpstreamTarget {
  readonly providerId: string
  readonly providerName: string
  readonly providerModelId: string
  /** 上游真实模型名。模型改写用的就是它。 */
  readonly providerModelName: string
  /** 密钥在密钥库中的引用；由 auth 修改器解析，传输层看不到。 */
  readonly apiKeyReference: string
  /** 该端点要求的自定义鉴权头名；`null` 表示走各协议默认的鉴权头。 */
  readonly customAuthHeader: string | null
  readonly endpointId: string
  readonly protocol: Protocol
  readonly url: string
  readonly timeoutMilliseconds: number
}

/** 一条已建立的上游连接。 */
export interface UpstreamConnection {
  /** 上游连接建立后立即可用；传输错误在这里抛出。 */
  readonly frames: AsyncIterable<Frame>
  /**
   * 上游写入侧。只有双向传输（WebSocket）提供；单向传输（HTTP）没有这一侧，
   * 因为「一次尝试 = 一条请求」的请求已经在建连时就发完了。
   */
  readonly outbound?: FrameSink
  /** 客户端取消或超时时中止上游。幂等。 */
  abort(reason?: Error): void
}

/** 传输实现。内核只依赖这个接口。 */
export interface Transport {
  /** 这个实现服务哪些传输形态；写在类型里，注册表不必再去比对一次。 */
  readonly transports: readonly TransportKind[]
  connect(target: UpstreamTarget, exchange: ExchangeView, attempt: AttemptView): Promise<UpstreamConnection>
}
