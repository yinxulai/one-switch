import type { Protocol } from '@common/schemas'
import { HTTP_METHODS, HttpRouter, normalizePathname, type HttpMethod } from '@server/http-router'
import type { ProtocolEnvelope, TransportKind } from '@server/proxy/contracts'
import type { ProtocolAdapter, ProtocolAdapterRegistry } from './shared/types'
import type { ProtocolDescriptor } from './descriptor'
import { anthropicMessagesDescriptor } from './anthropic-messages/descriptor'
import { openAiCompletionsDescriptor } from './openai-completions/descriptor'
import { openAiResponsesDescriptor } from './openai-responses/descriptor'
import type { ProtocolEndpointSpec } from '@server/proxy/contracts'

/** 全部已支持协议。新增协议只需在这里追加一个描述符。 */
export const protocolDescriptors: readonly ProtocolDescriptor[] = [
  openAiCompletionsDescriptor,
  openAiResponsesDescriptor,
  anthropicMessagesDescriptor,
]

export interface DeclaredProtocolRoute {
  readonly method: string
  readonly path: string
  readonly protocol: Protocol
  readonly endpointId: string
  /** 这个入口在哪些传输上成立。同一个 (方法, 路径) 可以由多条匹配规则归集出多个传输。 */
  readonly transports: readonly TransportKind[]
}

/** 入口匹配的结果：协议、接口、以及该接口在该传输上的封装描述。 */
export interface ProtocolEndpointMatch {
  readonly protocol: Protocol
  readonly endpointId: string
  readonly envelope: ProtocolEnvelope
}

interface DeclaredEndpoint {
  readonly protocol: Protocol
  readonly endpointId: string
  readonly spec: ProtocolEndpointSpec
  /** 这个入口在哪些传输上成立。命中路径但传输不在其中 = 该接口在该传输上不存在。 */
  readonly transports: ReadonlySet<TransportKind>
}

const adapters = new Map<string, ProtocolAdapter>()
const descriptorsById = new Map<Protocol, ProtocolDescriptor>()
const endpointsByKey = new Map<string, ProtocolEndpointSpec>()
const routes: DeclaredProtocolRoute[] = []
const declaredEndpointRouter = new HttpRouter<DeclaredEndpoint>()

for (const descriptor of protocolDescriptors) {
  descriptorsById.set(descriptor.id, descriptor)
  for (const adapter of descriptor.createAdapters()) {
    adapters.set(`${adapter.clientProtocol}:${adapter.endpointProtocol}`, adapter)
  }
  for (const endpoint of descriptor.endpoints) {
    const key = `${descriptor.id}:${endpoint.id}`
    if (endpointsByKey.has(key)) throw new Error(`协议接口重复声明: ${key}`)
    endpointsByKey.set(key, endpoint)
    // 一个接口可以有多条匹配规则，它们可能落到同一个 (方法, 路径) 上（同一接口在两种传输上
    // 用同样的方法），因此先把规则归集成「这个入口在哪些传输上成立」再挂载一次。
    // 传输是 handler 的属性而不是路由键的一部分：`HttpRouter` 一个 (方法, 路径) 只能挂一个 handler。
    const declaredTransports = Object.keys(endpoint.envelopes) as TransportKind[]
    const entries: { method: string, path: string, transports: Set<TransportKind> }[] = []
    for (const matcher of endpoint.match) {
      if (matcher.transport && !endpoint.envelopes[matcher.transport]) {
        throw new Error(`入口声明的传输没有对应封装: ${key} ${matcher.method} ${matcher.path} transport=${matcher.transport}`)
      }
      // 没写传输即「接口声明了封装的每个传输都适用这条规则」。
      const transports = matcher.transport ? [matcher.transport] : declaredTransports
      const methods = matcher.method === '*' ? HTTP_METHODS : [matcher.method]
      for (const method of methods) {
        const path = normalizePathname(matcher.path)
        let entry = entries.find(candidate => candidate.method === method && candidate.path === path)
        if (!entry) {
          entry = { method, path, transports: new Set<TransportKind>() }
          entries.push(entry)
        }
        for (const transport of transports) entry.transports.add(transport)
      }
    }
    for (const entry of entries) {
      if (routes.some(route => route.method === entry.method && route.path === entry.path)) {
        throw new Error(`入口重复声明: ${entry.method} ${entry.path}`)
      }
      routes.push({ method: entry.method, path: entry.path, protocol: descriptor.id, endpointId: endpoint.id, transports: [...entry.transports] })
      declaredEndpointRouter.mount({ [entry.path]: { protocol: descriptor.id, endpointId: endpoint.id, spec: endpoint, transports: entry.transports } }, entry.method as HttpMethod)
    }
  }
}

export const protocolAdapters: ProtocolAdapterRegistry = {
  resolve(clientProtocol, endpointProtocol): ProtocolAdapter {
    const adapter = adapters.get(`${clientProtocol}:${endpointProtocol}`)
    if (!adapter) throw new Error(`不支持的协议转换方向: ${clientProtocol} -> ${endpointProtocol}`)
    return adapter
  },
}

export function getProtocolDescriptor(protocol: Protocol): ProtocolDescriptor | undefined {
  return descriptorsById.get(protocol)
}

/** 已声明的入口路由，用于诊断与管理端展示。 */
export function listProtocolRoutes(): readonly DeclaredProtocolRoute[] {
  return routes
}

/** 按协议与接口 id 取接口声明；`endpointId` 来自入口匹配结果或模型端点的配置。 */
export function getProtocolEndpoint(protocol: Protocol, endpointId: string): ProtocolEndpointSpec | undefined {
  return endpointsByKey.get(`${protocol}:${endpointId}`)
}

/**
 * 从请求方法、路径与传输匹配接口。协议入口只在这里匹配一次。
 *
 * 判定分两步，顺序有意如此：先按 (方法, 路径) 命中接口，再看这个接口**在该传输上是否有封装**。
 * 两步合一的收益是拒绝原因可区分——`POST /v1/responses` 走 WS 是「这个路径上没有 WS 封装」，
 * 而 `POST /v1/messages` 走 WS 是「路径压根不认识」。
 */
export function matchProtocolEndpoint(method: string | undefined, pathname: string, transport: TransportKind = 'http'): ProtocolEndpointMatch | null {
  const declared = declaredEndpointRouter.match(method, pathname)?.handler
  if (!declared || !declared.transports.has(transport)) return null
  const envelope = declared.spec.envelopes[transport]
  if (!envelope) return null
  return { protocol: declared.protocol, endpointId: declared.endpointId, envelope }
}

/** 从请求方法与路径检测协议。 */
export function detectProtocolFromRequest(method: string | undefined, pathname: string): Protocol | null {
  return matchProtocolEndpoint(method, pathname)?.protocol ?? null
}
