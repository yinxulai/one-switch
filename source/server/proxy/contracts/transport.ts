import type { Protocol } from '@common/schemas'
import type { Frame, FrameSink } from './frame'
import type { AttemptView, ExchangeView } from './exchange'

/**
 * 传输实现种类。
 *
 * 现在只有 `'http'` 有实现；`'websocket'` 是**已声明但未实现**的轴取值（见 `transports/registry.ts`）。
 * 保留它是因为「协议 × 传输」是这套架构的两根正交轴：删掉这个取值，`UpstreamTarget.transport`
 * 就退化成常数，规划器的传输分支、入口的传输匹配、`envelopes` 的按传输索引都会跟着变成假动作。
 * 新增传输 = 扩展这个联合 + 在 `transports/` 下加一个 `Transport` 实现 + 在 registry 里加一个分支。
 */
export type TransportKind = 'http' | 'websocket'

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
  readonly transport: TransportKind
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
  readonly kind: TransportKind
  connect(target: UpstreamTarget, exchange: ExchangeView, attempt: AttemptView): Promise<UpstreamConnection>
}
