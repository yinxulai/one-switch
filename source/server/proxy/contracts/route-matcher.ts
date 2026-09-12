/**
 * 入口匹配支持的方法。
 *
 * 取值与 `@server/http-router` 的 `HttpMethod` 完全一致，但契约层是依赖图的最内层，
 * 不能反向 import server（否则「契约只描述形状」这句话就不成立）。
 * 两边的一致性由 `route-matcher.test.ts` 的双向可赋值断言守住，不靠注释约定。
 */
export type RouteMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' | '*'

/**
 * 入口匹配规则。协议入口与本地入口用同一套规则，所以「支持哪些接口」在两条路径上是
 * 同一种声明。
 *
 * 规则只由 `(方法, 路径)` 构成：传输形态不是匹配条件，因为入口在解析请求体之前就要选中
 * 封装，而那时还没有请求体可读。想要「同一个地址上收两种形态」就直接写两条规则。
 */
export interface RouteMatcher {
  readonly path: string
  readonly method: RouteMethod
}
