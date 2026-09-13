import { describe, expect, it } from 'vitest'
import { HTTP_METHODS, type HttpMethod } from '@server/http-router'
import type { RouteMethod } from './route-matcher'

// 契约层不能 import server（`scripts/check-proxy-layers.mjs` 会把这种反向依赖判为越界），
// 因此「方法词表」在两边各写一份，靠这里钉住它们不会漂移。
describe('route matcher contract', () => {
  it('keeps the method vocabulary in sync with @server/http-router', () => {
    // 双向可赋值断言：只写一个方向会漏掉「契约层多出一个方法」这种漂移。
    const fromServer: readonly RouteMethod[] = [...HTTP_METHODS, '*']
    const fromContract: readonly (HttpMethod | '*')[] = fromServer

    expect(fromContract).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'PUT', '*'])
  })
})
