import type { RequestContext } from '@server/proxy/request/request-context'

/**
 * 观测回调。
 *
 * 回调载荷只承载「标识」，不复制任何已经落到数据库的字段——数据库是这些
 * 事实的唯一真相源，回调里再存一份必然会与库里的值漂移。需要数据的消费者
 * 拿标识去查库即可。
 */
export interface ProxyObservationHooks {
  /**
   * 请求日志行已经写入之后触发。
   *
   * 之所以放在落库之后：回调里通常会去读这次请求的记录，如果行还不存在，
   * 消费者只会看到一个「查不到」的假象。
   */
  onRequestStarted?(context: RequestContext): void | Promise<void>
  /** 一次上游尝试已落库。 */
  onAttemptRecorded?(attempt: { requestId: string; attemptId: string }): void | Promise<void>
  /** 一次正文已落库。`perspective` 标明落在哪张表。 */
  onContentCaptured?(content: { requestId: string; perspective: 'client' | 'upstream' }): void | Promise<void>
}

export const NOOP_PROXY_OBSERVATION_HOOKS: ProxyObservationHooks = {}
