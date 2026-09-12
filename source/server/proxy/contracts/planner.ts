import type { Protocol } from '@common/schemas'
import type { TransportKind, UpstreamTarget } from './transport'

/** 候选耗尽的原因。执行器用它决定拒绝码，不再自己判断空数组的含义。 */
export type PlanExhaustedReason = 'model-not-configured' | 'manual-model-unavailable' | 'no-available-provider' | 'none'

export interface PlannerInput {
  readonly logicalModelId: string
  /** 客户端说的协议。规划器只认它，不去猜上游该是什么协议——那是端点配置的事。 */
  readonly clientProtocol: Protocol
  /** 管理端手工锁定的模型。非空时规划器只返回它，并忽略健康状态与启用开关。 */
  readonly manualModelId: string | null
  /**
   * 这次连接需要的传输能力。
   *
   * 规划器据此排除承载不了的候选：WebSocket 需要上游原生支持该协议（跨协议桥接不在 P1 范围内），
   * 而 HTTP 可以走协议转换，因此同一份模型配置在两种传输下会得出不同的候选集合。
   *
   * 今天只有 `'http'` 会被真正传进来（入口只有 http 匹配规则），因此这个参数与它的分支
   * 现在是一道**防线**：它保证「传输」这个轴在规划器里是被总处理的，而不是默默默认成 HTTP。
   */
  readonly transport: TransportKind
}

export interface PlanResult {
  readonly targets: readonly UpstreamTarget[]
  /** `targets` 非空时为 `'none'`。 */
  readonly reason: PlanExhaustedReason
  /**
   * 候选为空时的用户可见说明（入口用它拼错误信息与日志）。
   *
   * 规划器最清楚「为什么一个候选都没有」（缺协议、被手动锁定、没有启用的供应商……），
   * 让入口去猜只会让原因在两个地方各写一遍、并很快不同步。
   */
  readonly detail?: string
}

/**
 * 尝试规划器：唯一知道「这次请求该发往哪些上游、按什么顺序发」的地方。
 *
 * 执行器不再做路由决策：它只拿规划器给出的有序目标列表依次尝试。换一种策略
 * （成本最低、延迟最低、工作流编排）就是换一个规划器实现。
 */
export interface AttemptPlanner {
  readonly id: string
  plan(input: PlannerInput): PlanResult | Promise<PlanResult>
}
