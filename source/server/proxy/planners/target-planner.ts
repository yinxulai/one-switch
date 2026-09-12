import type { Protocol, ProviderModelRoute, ProviderModelRouteEndpoint } from '@common/schemas'
import type { AttemptPlanner, PlanResult, PlannerInput, TransportKind, UpstreamTarget } from '@server/proxy/contracts'
import {
  findConvertibleEndpoint,
  findEndpoint,
  getAvailableModels,
  type ModelWithProvider,
} from '@server/proxy/routing/router'
import { resolveUpstreamUrl } from '@server/proxy/routing/upstream-url'

/**
 * 默认尝试规划器。
 *
 * 它是整个代理里**唯一**的「路由决策点」：把「逻辑模型 + 客户端协议 + 传输能力」翻译成
 * 一份有序的 `UpstreamTarget` 列表（用户排序优先、健康模型优先），并把「一个候选都没有」
 * 的原因一并说清楚。执行器只管按顺序尝试，入口只管把原因翻成拒绝码——路由策略换了
 * （成本最低、延迟最低、工作流编排），只换这个文件。
 *
 * 三层信息在这里合成一份结果，任何一层都不需要知道另外两层：
 * - `routing/router`：谁能用（启用、健康、手动锁定）与端点匹配；
 * - 本文件：怎么把匹配结果拼成一次连接需要的全部事实（含 URL 与自定义鉴权头）；
 * - 调用方：拿不到候选时该说什么（`reason` / `detail`）。
 *
 * `buildUpstreamTarget` 是这个文件对外开的第二个口：一个模型的字段映射只有一份，
 * 批量规划与「测试连接」这种单点探测都走它。
 */
export const proxyTargetPlanner: AttemptPlanner = { id: 'proxy-target', plan: planProxyTargets }

/** 手动锁定的模型用不了时的说明：手动与自动的区别只在这句话里，因此只有一个来源。 */
const MANUAL_UNAVAILABLE_DETAIL = '手动指定的 ProviderModel 当前不可用于该协议'

/** 一个候选都没有且不是手动锁定时：既没有绑定模型、又都不可用。 */
const NO_MODEL_DETAIL = '该逻辑模型没有已启用且健康的供应商模型'

export async function planProxyTargets(input: PlannerInput): Promise<PlanResult> {
  const { logicalModelId, clientProtocol: protocol, manualModelId, transport } = input
  const availableModels = await getAvailableModels(logicalModelId, { manualModelId })

  // 手动模式下「候选为空」永远是「手动指定的模型不可用」，哪怕它是被删掉了：
  // 这种情况绝不能退化成「没有可用供应商」，否则用户看到的是一条与他的操作无关的报错。
  if (availableModels.length === 0) {
    return manualModelId === null
      ? { targets: [], reason: 'model-not-configured', detail: NO_MODEL_DETAIL }
      : { targets: [], reason: 'manual-model-unavailable', detail: MANUAL_UNAVAILABLE_DETAIL }
  }

  const targets = availableModels.flatMap(candidate => {
    const target = buildUpstreamTarget(candidate, protocol, transport)
    return target === null ? [] : [target]
  })
  if (targets.length === 0) {
    return manualModelId === null
      ? { targets: [], reason: 'no-available-provider', detail: describeCandidates(availableModels, protocol, transport) }
      : { targets: [], reason: 'manual-model-unavailable', detail: MANUAL_UNAVAILABLE_DETAIL }
  }

  return { targets, reason: 'none' }
}

/**
 * 把一个候选拼成一次连接需要的全部事实；这个候选服务不了该协议（或该传输）时返回 `null`。
 *
 * 执行器与传输层只认这份结果，不再回查模型与供应商。规划器批量规划时用它；
 * 设置页的「测试连接」只有一个特定模型要测、没有候选可排，也用同一个口，
 * 免得 URL 规范化、自定义鉴权头、端点标识这些字段映射在两处各写一遍、各自漂移。
 */
export function buildUpstreamTarget(candidate: ModelWithProvider, protocol: Protocol, transport: TransportKind): UpstreamTarget | null {
  const endpoint = selectEndpoint(candidate.model, protocol, transport)
  if (endpoint === undefined) return null

  return {
    providerId: candidate.provider.id,
    providerName: candidate.provider.name,
    providerModelId: candidate.model.id,
    providerModelName: candidate.model.modelName,
    apiKeyReference: candidate.provider.apiKeyReference,
    customAuthHeader: endpoint.customAuthHeader,
    endpointId: resolveEndpointId(candidate.model, endpoint.protocol),
    protocol: endpoint.protocol,
    url: readUpstreamUrl(endpoint.endpointUrl),
    transport,
    timeoutMilliseconds: candidate.provider.timeoutMilliseconds,
  }
}

/**
 * 挑选这次传输要用的端点。
 *
 * 原生端点永远优先；没有原生端点时，只有 HTTP 传输能接受「协议转换」的候选：
 * 双向长连接跨协议意味着要把两个方向上的帧桥接成请求再桥回来，那不是一个转换适配器
 * 能承担的事，所以双向传输只有原生候选。
 *
 * 另一种传输今天还没实现，也就是说这个分支现在不会被走到——留着它是因为它是这个函数的
 * **完整性**要求：删掉它，`transport` 为别的取值时就会静默地按 HTTP 规则给出候选。
 */
function selectEndpoint(model: ProviderModelRoute, protocol: Protocol, transport: TransportKind): ProviderModelRouteEndpoint | undefined {
  const native = findEndpoint(model, protocol)
  if (native) return native
  if (transport === 'websocket') return undefined
  return findConvertibleEndpoint(model, protocol)
}

/**
 * 上游地址：能解析就规范化，不能解析也原样交出去。
 *
 * 规划器不是校验器——一个写错的地址只该让**那一个**候选失败（其他候选照旧可切），
 * 因此这里不抛错。地址按原样发给传输层，由那次连接自己失败并计入健康冷却。
 */
function readUpstreamUrl(endpointUrl: string): string {
  try {
    return resolveUpstreamUrl(endpointUrl)
  } catch {
    return endpointUrl
  }
}

/**
 * 模型端点的稳定标识。
 *
 * 模型端点不是独立实体（一个模型在一个协议下最多一个端点），因此用「模型 + 协议」
 * 定位它：既能指到具体端点，也不会因为调度顺序变化而变。
 */
function resolveEndpointId(model: ProviderModelRoute, endpointProtocol: Protocol): string {
  return `${model.id}:${endpointProtocol}`
}

/** 为什么一个候选都用不上。这段文字同时是日志与用户看到的错误信息，只说事实、不猜原因。 */
function describeCandidates(availableModels: ModelWithProvider[], protocol: Protocol, transport: TransportKind): string {
  const discovered = availableModels.map(candidate => `${candidate.provider.name}/${candidate.model.modelName}`).join(', ')
  const suffix = discovered ? `，已发现: ${discovered}` : ''

  if (transport === 'websocket') {
    return `没有原生支持 ${protocol} 的可用 ProviderModel（WebSocket 传输需要上游原生支持该协议）${suffix}`
  }

  const configuredProtocols = [...new Set(availableModels.flatMap(candidate => candidate.model.endpoints.map(endpoint => endpoint.protocol)))]
  return `可用供应商模型未配置 ${protocol} 协议且未开启协议转换（当前配置协议: ${configuredProtocols.join(', ') || '无'}）${suffix}`
}
