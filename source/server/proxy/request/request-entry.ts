import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Protocol, RequestAttribute } from '@common/schemas'
import { listLogicalModels } from '@server/database/logical-model-store'
import { getSettings } from '@server/database/settings-store'
import { generateId } from '@common/utils'
import type { DeliveryMode } from '../contracts'
import { executeProxyRequest } from '../execution/attempt-executor'
import { initializeRequestLogger, type RequestLogger } from '../observability/logging'
import { NOOP_PROXY_OBSERVATION_HOOKS, type ProxyObservationHooks } from '../observability/hooks'
import { NodeProxyResponse } from '../response/proxy-response'
import { createRequestContext } from './request-context'
import { proxyTargetPlanner } from '../planners/target-planner'
import { matchProtocolEndpoint } from '../protocols/registry'
import { getManualModel } from '../routing/manual-routing'
import { resolveLogicalModel } from '../routing/logical-model-resolver'
import { collectRequestAttributes, extractClientRequestId } from '@server/proxy/observability/request-attribute-collector'

/**
 * 一次交换在入口处就已确定、且不随拒绝原因变化的事实。
 *
 * 「没走进代理执行链路就被拒掉」的请求同样是用户真实发出的请求，也必须落库：
 * 如果这里不写日志，「日志里没有」就会被误读成「没有发过这个请求」。
 */
interface ExchangeIdentity {
  requestId: string
  method: string
  path: string
  headers: IncomingMessage['headers']
  attributes: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  startedAt: number
  hooks: ProxyObservationHooks
}

/** 入口阶段已解析出的事实；尚未解析到时为 `null`。 */
interface ExchangeResolution {
  /** 已解析出的逻辑模型；尚未进入逻辑模型解析时为 `null`。 */
  logicalModelId: string | null
  /** 已识别出的客户端协议；连 API 路径都无法识别时为 `null`。 */
  clientProtocol: Protocol | null
  /** 已读到的请求体。客户端中途断开时是断开前已经收到的部分，可能不完整。 */
  requestBody: Buffer
  /** 客户端要求的交付方式。由接口的封装描述解析；接口都无法识别时为 `'buffered'`。 */
  delivery: DeliveryMode
}

/** 我们回给客户端的拒绝响应。 */
interface ExchangeRefusal {
  statusCode: number
  errorCode: string
  errorMessage: string
}

interface RejectedExchange extends ExchangeIdentity, ExchangeResolution {
  refusal: ExchangeRefusal
}

type AbortedExchange = ExchangeIdentity & ExchangeResolution

/** 尚未读到请求体时的占位，避免在多个分支里重复分配。 */
const NO_REQUEST_BODY = Buffer.alloc(0)

/** 读取客户端请求体的结果；`aborted` 为真表示客户端没把正文发完就断开了。 */
interface RequestBodyReadResult {
  body: Buffer
  aborted: boolean
}

/**
 * 处理一次 HTTP 代理请求。
 *
 * 逻辑模型不靠调用方指定：一律由请求自己带的模型名解析出来（见下面的 `resolveLogicalModel`）。
 * 早先这里有个 `logicalModelId` 入参，但它在函数内部一解析完就被覆盖掉，
 * 留着只会让人误以为可以在外部指定逻辑模型，已经删掉。
 */
export async function handleProxyRequest(req: IncomingMessage, res: ServerResponse, hooks: ProxyObservationHooks = NOOP_PROXY_OBSERVATION_HOOKS): Promise<void> {
  const startedAt = Date.now()
  const requestId = generateId('req_')
  const method = req.method ?? 'POST'
  const path = req.url ?? '/'
  const attributes = collectRequestAttributes(req.headers)
  // 交换标识在这里一次绑好：下面所有拒绝分支共用同一份，不必逐条重复。
  const identity: ExchangeIdentity = { requestId, method, path, headers: req.headers, attributes, startedAt, hooks }
  /** 拒绝这次交换：回错误响应 + 记一条失败日志。 */
  const reject = (refusal: ExchangeRefusal, resolution: ExchangeResolution) => rejectExchange(res, { ...identity, ...resolution, refusal })
  /** 客户端中途断开：没有响应可写，只记一条已取消。 */
  const abort = (resolution: ExchangeResolution) => recordAbortedExchange({ ...identity, ...resolution })

  // 入口匹配一次，同时定下协议、接口与封装描述；后面的模型读写与流式判定都问这个结果。
  const endpoint = matchProtocolEndpoint(method, path)
  if (!endpoint) {
    console.warn(`[proxy] unknown API path method=${method} path=${path} requestId=${requestId}`)
    await reject({ statusCode: 404, errorCode: 'UNKNOWN_API_PATH', errorMessage: '无法识别的 API 路径' }, { logicalModelId: null, clientProtocol: null, requestBody: NO_REQUEST_BODY, delivery: 'buffered' })
    return
  }
  const protocol = endpoint.protocol
  const requestUrl = new URL(path, 'http://localhost')
  /** 封装描述的入参：模型读写与流式判定都只看这三样。 */
  const readEnvelope = (body: Buffer) => ({ headers: req.headers, body, url: requestUrl })

  const { body: requestBody, aborted } = await readRequestBody(req)
  if (aborted) {
    // 客户端在正文读完前断开：请求确实到达了代理，但我们既拿不到完整正文，
    // 也没有任何响应能写回客户端，只能记成「已取消」——但不能因此不记。
    console.debug(`[proxy] client request aborted requestId=${requestId} phase=read-body bodyBytes=${requestBody.length}`)
    await abort({ logicalModelId: null, clientProtocol: protocol, requestBody, delivery: endpoint.envelope.resolveDelivery(readEnvelope(requestBody)) })
    return
  }
  const clientRequestId = extractClientRequestId(req.headers)
  console.debug(`[proxy] request accepted requestId=${requestId} clientRequestId=${clientRequestId ?? 'none'} method=${req.method ?? 'POST'} path=${req.url ?? '/'} protocol=${protocol} endpoint=${endpoint.endpointId} bodyBytes=${requestBody.length}`)
  const envelopeInput = readEnvelope(requestBody)
  const delivery = endpoint.envelope.resolveDelivery(envelopeInput)
  const modelResult = endpoint.envelope.readModel(envelopeInput)
  if (!modelResult.ok) {
    console.warn(`[proxy] invalid model request requestId=${requestId} protocol=${protocol} reason=${modelResult.reason}`)
    await reject({ statusCode: 400, errorCode: 'INVALID_MODEL', errorMessage: modelResult.reason }, { logicalModelId: null, clientProtocol: protocol, requestBody, delivery })
    return
  }

  // 请求模型 → 逻辑模型：命中就直连，没命中回落到内建默认逻辑模型。
  // 解析规则收敛在 `resolveLogicalModel` 里，WebSocket 入口用的是同一个函数。
  const requestedModel = modelResult.model.trim()
  const resolution = resolveLogicalModel(await listLogicalModels(), requestedModel)
  if (!resolution) {
    console.error(`[proxy] no enabled logical model requestId=${requestId} requestedModel=${requestedModel}`)
    await reject({ statusCode: 503, errorCode: 'NO_MODEL_CONFIGURED', errorMessage: '还没有配置已启用的 default 逻辑模型' }, { logicalModelId: null, clientProtocol: protocol, requestBody, delivery })
    return
  }
  const logicalModelId = resolution.logicalModel.id
  console.debug(`[proxy] logical model resolved requestId=${requestId} requestedModel=${requestedModel} logicalModelId=${logicalModelId} fallback=${!resolution.matched}`)

  const controller = new AbortController()
  req.once('aborted', () => controller.abort())
  res.once('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  const context = createRequestContext({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    // 这个入口就是 HTTP：传输在这里定一次，后面的交换投影与修改器上下文共用它。
    transport: 'http',
    method,
    path,
    headers: req.headers,
    attributes,
    requestBody,
    delivery,
    signal: controller.signal,
  })

  const manualModelId = getManualModel(logicalModelId)
  const plan = await proxyTargetPlanner.plan({ logicalModelId, clientProtocol: protocol, manualModelId, transport: 'http' })
  console.debug(`[proxy] routing planned requestId=${requestId} logicalModelId=${logicalModelId} protocol=${protocol} planner=${proxyTargetPlanner.id} manualModelId=${manualModelId ?? 'none'} reason=${plan.reason} targets=${plan.targets.length} targetOrder=${plan.targets.map(target => target.providerModelId).join(',') || 'none'}`)
  if (plan.reason === 'manual-model-unavailable') {
    console.warn(`[proxy] manual provider model unavailable requestId=${requestId} logicalModelId=${logicalModelId} protocol=${protocol} detail=${plan.detail ?? 'none'}`)
    await reject({ statusCode: 409, errorCode: 'MANUAL_MODEL_UNAVAILABLE', errorMessage: plan.detail ?? '手动指定的 ProviderModel 当前不可用于该协议' }, { logicalModelId, clientProtocol: protocol, requestBody, delivery })
    return
  }
  if (plan.targets.length === 0) {
    const detail = plan.detail ?? '该逻辑模型没有已启用且健康的供应商模型'
    console.warn(`[proxy] 没有可用的上游供应商: ${req.method} ${req.url} (protocol=${protocol}, logicalModel=${resolution.logicalModel.name} [${logicalModelId}], requestId=${requestId}, reason=${plan.reason}, detail=${detail})`)
    await reject({ statusCode: 503, errorCode: 'NO_AVAILABLE_PROVIDER', errorMessage: `没有可用的上游 Provider：${detail}` }, { logicalModelId, clientProtocol: protocol, requestBody, delivery })
    return
  }

  console.debug(`[proxy] execution started requestId=${requestId} logicalModelId=${logicalModelId} targets=${plan.targets.length}`)
  await executeProxyRequest({ context, targets: plan.targets, response: new NodeProxyResponse(res), hooks })
}

/**
 * 打开这次交换的日志器，并补齐「是否采集正文」这个唯一来自设置的字段。
 *
 * 入口阶段的两条出口（拒绝、中断）都从这里拿日志器，保证这个判断只有一个点。
 */
async function openExchangeLogger(input: ExchangeIdentity & ExchangeResolution): Promise<RequestLogger> {
  const settings = await getSettings()
  return initializeRequestLogger({
    requestId: input.requestId,
    logicalModelId: input.logicalModelId,
    clientProtocol: input.clientProtocol,
    method: input.method,
    path: input.path,
    headers: input.headers,
    attributes: input.attributes,
    requestBody: input.requestBody,
    delivery: input.delivery,
    captureRequestContent: settings.captureRequestContent,
    hooks: input.hooks,
  })
}

/** 拒绝收尾：回一条错误响应，再记一条失败日志。入口处所有拒绝分支共用。 */
async function rejectExchange(res: ServerResponse, input: RejectedExchange): Promise<void> {
  const responseBody = writeJsonError(res, input.refusal.statusCode, input.refusal.errorCode, input.refusal.errorMessage)
  const logger = await openExchangeLogger(input)
  await logger.finalizeLocalErrorContent(input.refusal.statusCode, res.getHeaders(), responseBody)
  await logger.finalizeRequestLog('failed', input.startedAt)
}

/** 中断收尾：写入一条被客户端中断的记录，没有响应写出，因此不写客户端正文的响应侧。 */
async function recordAbortedExchange(input: AbortedExchange): Promise<void> {
  const logger = await openExchangeLogger(input)
  await logger.finalizeRequestLog('cancelled', input.startedAt)
}

/**
 * 读取客户端请求体。
 *
 * 不用 reject 表达「读不完」：调用方拿到 reject 只会让它抛出请求入口，于是这次请求
 * 在记录里彻底消失（客户端那边却真实地失败了一次）。把结果交回调用方，才能记「已取消」。
 */
function readRequestBody(req: IncomingMessage): Promise<RequestBodyReadResult> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let settled = false
    const finish = (aborted: boolean) => {
      if (settled) return
      settled = true
      resolve({ body: Buffer.concat(chunks), aborted })
    }
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => finish(false))
    req.on('aborted', () => finish(true))
    req.on('error', () => finish(true))
    // 已经发过的事件不会重发：漏掉 `aborted` 会让这个 Promise 永远挂着，于是这次
    // 请求永远不会被记录。
    if (req.aborted) finish(true)
  })
}

function writeJsonError(res: ServerResponse, statusCode: number, errorCode: string, errorMessage: string): string {
  const responseBody = JSON.stringify({ success: false, errorCode, errorMessage })
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(responseBody)
  return responseBody
}
