import type { Protocol } from '@common/schemas'
import { HTTP_METHODS, HttpRouter, normalizePathname, type HttpMethod } from '@server/http-router'
import type { ProtocolEnvelope } from '@server/proxy/contracts'
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
}

/** 入口匹配的结果：协议、接口、以及该接口的封装描述。 */
export interface ProtocolEndpointMatch {
  readonly protocol: Protocol
  readonly endpointId: string
  readonly envelope: ProtocolEnvelope
}

interface DeclaredEndpoint {
  readonly protocol: Protocol
  readonly endpointId: string
  readonly spec: ProtocolEndpointSpec
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
    // 一个接口可以有多条匹配规则（`*` 方法、多个路径别名），先展开成具体的 (方法, 路径)。
    // 路由键里没有传输形态：`HttpRouter` 一个键只能挂一个 handler，而形态的差异在响应体
    // 怎么分帧，不影响「这个请求该交给哪个协议接口」。
    const entries: { method: string, path: string }[] = []
    for (const matcher of endpoint.match) {
      const methods = matcher.method === '*' ? HTTP_METHODS : [matcher.method]
      for (const method of methods) {
        const path = normalizePathname(matcher.path)
        if (!entries.some(entry => entry.method === method && entry.path === path)) {
          entries.push({ method, path })
        }
      }
    }
    for (const entry of entries) {
      if (routes.some(route => route.method === entry.method && route.path === entry.path)) {
        throw new Error(`入口重复声明: ${entry.method} ${entry.path}`)
      }
      routes.push({ method: entry.method, path: entry.path, protocol: descriptor.id, endpointId: endpoint.id })
      declaredEndpointRouter.mount({ [entry.path]: { protocol: descriptor.id, endpointId: endpoint.id, spec: endpoint } }, entry.method as HttpMethod)
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
 * 从请求方法与路径匹配接口。协议入口只在这里匹配一次。
 */
export function matchProtocolEndpoint(method: string | undefined, pathname: string): ProtocolEndpointMatch | null {
  const declared = declaredEndpointRouter.match(method, pathname)?.handler
  if (!declared) return null
  return { protocol: declared.protocol, endpointId: declared.endpointId, envelope: declared.spec.envelope }
}

/** 从请求方法与路径检测协议。 */
export function detectProtocolFromRequest(method: string | undefined, pathname: string): Protocol | null {
  return matchProtocolEndpoint(method, pathname)?.protocol ?? null
}
