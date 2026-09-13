import type { Transport, TransportKind } from '@server/proxy/contracts'
import { createHttpTransport, type HttpTransportOptions } from './http'

/**
 * 建连需要的外部输入。
 *
 * `transport` 决定用哪种传输实现，其余字段是各实现自己的输入。把它们放在同一个对象里，是为了让调用方
 * 能在「运行时才知道形态」的地方取实现：如果调用方必须自己写一个 `switch`，那「新增一种传输」就又要
 * 改一次调用方——而调用方本来只该知道一件事：我要一个能连到这种形态的东西。
 */
export interface TransportResolution {
  /** 上游跳的传输形态，由 `resolveUpstreamTransport(url, 客户端形态)` 算出来。 */
  readonly transport: TransportKind
  /**
   * 上游两个数据块之间允许的最长静默时间（毫秒），<=0 表示不超时。
   *
   * 只有 HTTP 读它：HTTP 连接会被复用，传输必须知道何时回收；WS 连接的寿命就是一次交换的寿命，
   * 没有「空闲」可言。因此省略它是合法的，但 HTTP 分支缺它会直接报错——退回「永不超时」是一次
   * 静默的行为降级，比早失败难查得多。
   */
  readonly resolveIdleTimeoutMilliseconds?: HttpTransportOptions['resolveIdleTimeoutMilliseconds']
}

/**
 * 按**传输形态**取实现。
 *
 * 这是全仓唯一一处「形态 → 实现」的映射，因此也是「新增一种传输」唯一需要新增分支的地方。
 * 没有它，执行器就会写死 HTTP：`transport` 是一个已声明的事实，写死等于把一个声明出来的
 * 字段变成装饰——将来真的给出另一种形态的候选时，代码会静默地用错实现。
 *
 * 注意一个实现可以服务多种形态：HTTP 实现同时服务 `'http'` 与 `'http-stream'`，
 * 因为它们在建连、TLS、超时、abort、出网方式上一字不差，差别只在响应体怎么分帧。
 */
export function resolveTransportImplementation(resolution: TransportResolution): Transport {
  if (resolution.transport === 'websocket') {
    // `'websocket'` 是已声明但未实现的取值（见 `contracts/transport.ts`）。走到这里说明规划器
    // 真的给出了一条 WS 候选，而它本不该：没有实现时就不能产生这种候选。报错比静默回退到 HTTP
    // 好得多——后者会拿一个 WS 地址去发 HTTP 请求，失败原因与真实原因相差十万八千里。
    throw new Error('WebSocket transport is not implemented: the planner must not produce websocket candidates')
  }
  const resolveIdleTimeoutMilliseconds = resolution.resolveIdleTimeoutMilliseconds
  if (!resolveIdleTimeoutMilliseconds) throw new Error('The HTTP transport needs resolveIdleTimeoutMilliseconds: connections are reused, so the idle timeout must be known')
  return createHttpTransport({ resolveIdleTimeoutMilliseconds })
}
