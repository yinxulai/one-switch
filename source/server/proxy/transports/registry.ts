import type { Transport, TransportKind } from '@server/proxy/contracts'
import { createHttpTransport, type HttpTransportOptions } from './http'

/**
 * 建连需要的外部输入。
 *
 * `kind` 决定用哪种传输，其余字段是各传输自己的输入。把它们放在同一个对象里，是为了让调用方
 * 能在「运行时才知道传输种类」的地方取实现：执行器只知道 `target.transport`，如果它必须自己
 * 写一个 `switch`，那「新增一种传输」就又要改一次调用方——而调用方本来只该知道一件事：我要一个
 * 能连到 `target.transport` 的东西。
 */
export interface TransportResolution {
  readonly kind: TransportKind
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
 * 按传输种类取实现。
 *
 * 这是全仓唯一一处「传输种类 → 传输实现」的映射，因此也是「新增传输」唯一需要新增分支的地方。
 * 没有它，执行器就会写死 HTTP：`target.transport` 是一个已声明的事实，写死等于把一个声明出来的
 * 字段变成装饰——将来规划器真的给出另一种传输的候选时，代码会静默地用错实现。
 */
export function resolveTransport(resolution: TransportResolution): Transport {
  if (resolution.kind === 'websocket') {
    // `'websocket'` 是已声明但未实现的轴取值（见 `contracts/transport.ts`）。走到这里说明规划器
    // 真的给出了一条 WS 候选，而它本不该：没有实现时就不能产生这种候选。报错比静默回退到 HTTP
    // 好得多——后者会拿一个 WS 地址去发 HTTP 请求，失败原因与真实原因相差十万八千里。
    throw new Error('WebSocket 传输尚未实现：规划器不应产出 websocket 候选')
  }
  const resolveIdleTimeoutMilliseconds = resolution.resolveIdleTimeoutMilliseconds
  if (!resolveIdleTimeoutMilliseconds) throw new Error('HTTP 传输需要 resolveIdleTimeoutMilliseconds：连接会被复用，必须知道空闲多久回收')
  return createHttpTransport({ resolveIdleTimeoutMilliseconds })
}
