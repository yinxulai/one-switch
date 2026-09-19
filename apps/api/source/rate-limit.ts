/**
 * 端点限流：**尽力而为**的一层，不是安全边界。
 *
 * 端点公开，必须假设会被人灌垃圾（telemetry.md §7）。这里用内存里的定窗口计数器挡掉
 * 「同一个安装标识或同一个来源 IP 在短时间内打爆」这种最省事的滥用；而 `/v1/events`
 * 本身是幂等追加、无鉴权、无副作用的，所以漏挡不构成风险——真正的防护应该配在域名上
 * （Cloudflare 的 Rate limiting rules、WAF），那是运维配置，不是这段代码能替的。
 *
 * **局限写在类型里**：状态住在 isolate 的内存里，所以
 * - 只在同一个 isolate 内有效（Cloudflare 会同时跑很多个）；
 * - isolate 被回收就归零；
 * - 不同机房各自计数，实际放行量是「配置值 × 机房数」的量级。
 *
 * 这足够挡住手写的循环脚本，不够挡分布式压测。要挡后者必须上域名级规则。
 */

export interface RateLimiter {
  /**
   * 记一次访问并回答是否放行。**拒绝的访问也计数**——否则持续超限的调用方会永远看不到限流。
   */
  admit(key: string, now: number): boolean
}

export interface RateLimiterOptions {
  /** 窗口长度（毫秒）。 */
  windowMilliseconds: number
  /** 每个窗口的放行次数上限。 */
  maxPerWindow: number
  /** 状态表里最多同时记多少个键；超过就清一轮。 */
  maxKeys: number
}

type Counter = { count: number; windowStart: number }

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const counters = new Map<string, Counter>()

  return {
    admit(key, now) {
      const existing = counters.get(key)
      if (existing === undefined) {
        if (counters.size >= options.maxKeys) evict(counters, now, options.windowMilliseconds, options.maxKeys)
        counters.set(key, { count: 1, windowStart: now })
        return true
      }
      if (now - existing.windowStart >= options.windowMilliseconds) {
        counters.set(key, { count: 1, windowStart: now })
        return true
      }
      existing.count += 1
      return existing.count <= options.maxPerWindow
    },
  }
}

/**
 * 先清过期的；清完还在上限上，说明这一刻真的有很多不同的键（一次洪峰），**整表清空**。
 * 宁可短暂多放行几个请求，也不能让这张表长成内存里的第二个泄漏点。
 */
function evict(counters: Map<string, Counter>, now: number, windowMilliseconds: number, maxKeys: number): void {
  for (const [key, entry] of counters) {
    if (now - entry.windowStart >= windowMilliseconds) counters.delete(key)
  }
  if (counters.size >= maxKeys) counters.clear()
}
