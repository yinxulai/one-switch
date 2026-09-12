import type { TransportKind } from './transport'

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
 * `transport` 是**匹配条件**而不是接口身份的一部分：同一个接口在两种传输上可以有不同的
 * 方法与路径（比如同一个地址，HTTP 用 `POST` 与上游 REST 端点同形，另一种载体用 `GET`
 * 与客户端建连的写法同形），但它们仍然是**同一个接口**。省略表示「该接口声明了封装的
 * 每个传输都适用这条规则」，因此只有需要区分时才写它。
 *
 * 把传输写进接口 id（例如 `responses` 与 `responses-websocket`）是错的：那会让
 * 「同一接口支持哪些传输」这句话失去唯一答案，也会让只改传输的改动看起来像新增接口。
 */
export interface RouteMatcher {
  readonly path: string
  readonly method: RouteMethod
  /** 这条规则只在某个传输下成立；省略表示接口声明了封装的每个传输。 */
  readonly transport?: TransportKind
}
