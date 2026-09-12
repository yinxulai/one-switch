import type { Protocol } from '@common/schemas'
import { readLandingModelIds, runWorkflow } from '@common/router/engine'
import type { RouteContextInput, WorkflowRequestPayload, WorkflowRunResult, WorkflowTrace, WorkflowTransport } from '@common/router/types'
import { listLogicalModels } from '@server/database/logical-model-store'
import { resolveRouterGraph } from '@server/database/router-graph-store'
import { createRouteCapabilities } from '../capabilities/route-capabilities'
import type { HeaderMap } from '../contracts'

/**
 * 一次请求的路由求解：读当前生效的图 → 组装上下文 → 跑图 → 取落点。
 *
 * 这是「工作流图接入代理」的唯一交接面。代理入口不解释图，图也不认识 HTTP：
 * 入口负责把请求摊成图能读的形状（路径、方法、头、体），图负责算出落点逻辑模型，
 * 之后照旧交给规划器与执行器。
 */

export interface RouteResolutionInput {
  /** 归一化后的客户端请求：图能读到的就是这些。 */
  readonly request: WorkflowRequestPayload
  /** 客户端协议。端点匹配时就已经确定，不再让图去猜。 */
  readonly clientProtocol: Protocol
  /** 传输方式：HTTP 的流式请求是 `http-sse`，升级连接是 `websocket`。 */
  readonly transport: WorkflowTransport
  /** 本次运行的追踪 id，直接沿用交换 id，让图与请求日志指向同一个交换。 */
  readonly traceId: string
}

export interface RouteResolution {
  /** 图选出的落点逻辑模型，按优先级排列；没有落点时为空数组。 */
  readonly logicalModelIds: string[]
  /** 生效的图版本；`0` 表示还没有人保存过图，用的是内建默认策略。 */
  readonly graphVersion: number
  /** 图停下来时的原因，用于日志。 */
  readonly stopReason: WorkflowRunResult['stopReason']
  /** 完整的节点轨迹，用于排查「为什么落点不是我预期的那个」。 */
  readonly trace: WorkflowTrace[]
}

export async function resolveRoute(input: RouteResolutionInput): Promise<RouteResolution> {
  const [snapshot, logicalModels] = await Promise.all([resolveRouterGraph(), listLogicalModels()])

  const routeContext = {
    request: input.request,
    // 主进程的逻辑模型天然满足 `RuntimeLogicalModel`（多出来的字段没人读），直接交进去。
    logicalModels,
    metadata: { traceId: input.traceId },
    protocol: input.clientProtocol,
    transport: input.transport,
  } satisfies RouteContextInput

  // 脚本沙箱与提示词调用要主进程的资源：图在代理里跑，能力就必须在这里注入，
  // 否则图上真配了这两种节点，运行时只会得到一句「能力未注入」。
  const result = await runWorkflow(snapshot.graph, routeContext, { capabilities: createRouteCapabilities() })

  return {
    logicalModelIds: readLandingModelIds(result.outputPayload),
    graphVersion: snapshot.version,
    stopReason: result.stopReason,
    trace: result.trace,
  }
}

/** 把 Node 的多值头字典压成图里用的单值字典（同名头按 `,` 合并，口径与引擎的归一化一致）。 */
export function toRouteHeaders(headers: HeaderMap): Record<string, string> {
  const flattened: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    flattened[name] = Array.isArray(value) ? value.join(',') : value
  }
  return flattened
}

/**
 * 请求体解析成对象供图读取。
 *
 * 不是 JSON 体时给空对象而不是原文：图的字段路径是按「请求体是对象」写的，
 * 给字符串只会让条件判定全部落到「字段不存在」上，与给空对象的结果一样，
 * 却要让每个读体字段的节点各自兜底一次。空体同理。
 */
export function parseRouteBody(body: Buffer): Record<string, unknown> {
  if (body.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}
