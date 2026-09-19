import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rate-limit'

const OPTIONS = { windowMilliseconds: 60_000, maxPerWindow: 3, maxKeys: 10 }
const NOW = 1_700_000_000_000

describe('限流计数器', () => {
  it('窗口内放行到上限为止', () => {
    const limiter = createRateLimiter(OPTIONS)

    expect([1, 2, 3, 4, 5].map(() => limiter.admit('a', NOW))).toEqual([true, true, true, false, false])
  })

  it('被拒绝的访问也计数，持续超限不会等到窗口末尾才恢复', () => {
    const limiter = createRateLimiter(OPTIONS)
    for (let index = 0; index < 10; index += 1) limiter.admit('a', NOW)

    // 窗口还没滑到下一格，仍然拒绝；这与「只数放行的」实现不同。
    expect(limiter.admit('a', NOW + 59_999)).toBe(false)
  })

  it('窗口一到就重置，而不需要等所有计数过期', () => {
    const limiter = createRateLimiter(OPTIONS)
    for (let index = 0; index < 5; index += 1) limiter.admit('a', NOW)

    expect(limiter.admit('a', NOW + 60_000)).toBe(true)
    expect(limiter.admit('a', NOW + 60_000)).toBe(true)
    expect(limiter.admit('a', NOW + 60_000)).toBe(true)
    expect(limiter.admit('a', NOW + 60_000)).toBe(false)
  })

  it('键之间互不影响', () => {
    const limiter = createRateLimiter(OPTIONS)
    for (let index = 0; index < 5; index += 1) limiter.admit('a', NOW)

    expect(limiter.admit('b', NOW)).toBe(true)
  })

  it('不同的窗口起点是各自第一次访问的时刻', () => {
    const limiter = createRateLimiter(OPTIONS)

    limiter.admit('a', NOW)
    limiter.admit('b', NOW + 30_000)

    // a 的窗口在 +30s 时已过半，b 的刚开始；两者互不牵连。
    expect(limiter.admit('a', NOW + 60_000)).toBe(true)
    expect(limiter.admit('b', NOW + 60_000)).toBe(true)
  })

  it('键数到上限时清掉过期的，不清就整表清空', () => {
    const limiter = createRateLimiter({ ...OPTIONS, maxKeys: 2 })

    limiter.admit('a', NOW)
    limiter.admit('b', NOW)
    // 表满且都还新鲜 → 整表清空，新键照样进得来（宁可短暂多放行也不让表无限长）。
    expect(limiter.admit('c', NOW)).toBe(true)

    limiter.admit('d', NOW)
    limiter.admit('e', NOW)
    // 上一轮被清空了，所以 'a' 重新开始计数而不是继承旧账。
    expect(limiter.admit('a', NOW)).toBe(true)
  })

  it('表满但已有过期项时只清过期的', () => {
    const limiter = createRateLimiter({ ...OPTIONS, maxKeys: 2 })

    limiter.admit('a', NOW)
    limiter.admit('b', NOW)
    // 插入 'c' 时 'a' / 'b' 都过期了，清掉就有位置，不必整表清空。
    expect(limiter.admit('c', NOW + 60_000)).toBe(true)
    // 上一轮只清了过期的，所以计数器表是干净的：新键各自从 1 开始，额度是完整的。
    expect(limiter.admit('d', NOW + 60_000)).toBe(true)
    expect(limiter.admit('e', NOW + 60_000)).toBe(true)
    expect(limiter.admit('f', NOW + 60_000)).toBe(true)
  })

  it('上限只在插入新键时检查，存量多的表也会被下一次插入清空', () => {
    const limiter = createRateLimiter({ ...OPTIONS, maxKeys: 2 })
    // 表里已经有两个新鲜键。
    limiter.admit('a', NOW)
    limiter.admit('b', NOW)

    for (const key of ['c', 'd', 'e', 'f']) {
      // 上限只在新键进表的那一刻检查：满了又没有过期项可清，就整表清空重来。
      expect(limiter.admit(key, NOW)).toBe(true)
    }

    // 清空意味着 'a' 的旧账没了，它可以重新拿到完整额度。
    expect([1, 2, 3, 4].map(() => limiter.admit('a', NOW))).toEqual([true, true, true, false])
  })
})
