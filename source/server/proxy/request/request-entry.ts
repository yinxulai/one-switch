import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import type { Protocol, RequestAttribute, RequestStatus } from '@common/schemas'
import { listLogicalModels } from '@server/database/logical-model-store'
import { getSettings } from '@server/database/settings-store'
import { generateId } from '@common/utils'
import { executeProxyRequest } from '../execution/attempt-executor'
import { initializeRequestLogger } from '../observability/logging'
import { NOOP_PROXY_OBSERVATION_HOOKS, type ProxyObservationHooks } from '../observability/hooks'
import { NodeProxyResponse } from '../response/proxy-response'
import { createRequestContext } from './request-context'
import { validateLogicalModel } from './request'
import { resolveProxyTargets } from '../routing/routing'
import { detectProtocolFromPath } from '../routing/router'
import { getManualModel } from '../routing/manual-routing'
import { collectRequestAttributes, extractClientRequestId } from '@server/proxy/observability/request-attribute-collector'

/**
 * 「没走进代理执行链路就被拒掉」的请求记录入参。
 *
 * 这些分支在请求上下文建立之前就返回了，但它们同样是用户真实发出的请求。
 * 如果这里不写日志，「日志里没有」就会被误读成「没有发过这个请求」。
 */
interface RejectedRequestRecord {
  requestId: string
  /** 已解析出的逻辑模型；尚未解析到时为 `null`。 */
  logicalModelId: string | null
  /** 已识别出的客户端协议；连 API 路径都无法识别时为 `null`。 */
  clientProtocol: Protocol | null
  method: string
  path: string
  headers: IncomingMessage['headers']
  attributes: Array<Omit<RequestAttribute, 'requestId' | 'createdTime'>>
  /** 已读到的请求体。客户端中途断开时是断开前已经收到的部分，可能不完整。 */
  requestBody: Buffer
  /** 是否采集正文——决定是否同时写 `request_contents`。 */
  captureRequestContent: boolean
  startedAt: number
  status: RequestStatus
  statusCode: number
  responseHeaders: OutgoingHttpHeaders
  responseBody: string
  hooks: ProxyObservationHooks
}

/** 读取客户端请求体的结果；`aborted` 为真表示客户端没把正文发完就断开了。 */
interface RequestBodyReadResult {
  body: Buffer
  aborted: boolean
}

export async function handleProxyRequest(req: IncomingMessage, res: ServerResponse, logicalModelId: string, hooks: ProxyObservationHooks = NOOP_PROXY_OBSERVATION_HOOKS): Promise<void> {
  const startedAt = Date.now()
  const requestId = generateId('req_')
  const method = req.method ?? 'POST'
  const path = req.url ?? '/'
  const attributes = collectRequestAttributes(req.headers)
  const protocol = detectProtocolFromPath(req.url!)
  if (!protocol) {
    console.warn(`[proxy] unknown API path method=${method} path=${path} logicalModelId=${logicalModelId} requestId=${requestId}`)
    const responseBody = writeJsonError(res, 404, 'UNKNOWN_API_PATH', '无法识别的 API 路径')
    const settings = await getSettings()
    await recordRejectedRequest({
      requestId,
      logicalModelId: null,
      clientProtocol: null,
      method,
      path,
      headers: req.headers,
      attributes,
      requestBody: Buffer.alloc(0),
      captureRequestContent: settings.captureRequestContent,
      startedAt,
      status: 'failed',
      statusCode: 404,
      responseHeaders: res.getHeaders(),
      responseBody,
      hooks,
    })
    return
  }

  const { body: requestBody, aborted } = await readRequestBody(req)
  if (aborted) {
    // 客户端在正文读完前断开：请求确实到达了代理，但我们既拿不到完整正文，
    // 也没有任何响应能写回客户端，只能记成「已取消」——但不能因此不记。
    console.debug(`[proxy] client request aborted requestId=${requestId} phase=read-body bodyBytes=${requestBody.length}`)
    await recordAbortedRequest({ requestId, logicalModelId: null, clientProtocol: protocol, method, path, headers: req.headers, attributes, requestBody, startedAt, hooks })
    return
  }
  const clientRequestId = extractClientRequestId(req.headers)
  console.debug(`[proxy] request accepted requestId=${requestId} clientRequestId=${clientRequestId ?? 'none'} method=${req.method ?? 'POST'} path=${req.url ?? '/'} protocol=${protocol} bodyBytes=${requestBody.length}`)
  const modelValidationError = validateLogicalModel(requestBody)
  if (modelValidationError) {
    console.warn(`[proxy] invalid model request requestId=${requestId} protocol=${protocol} reason=${modelValidationError}`)
    const responseBody = writeJsonError(res, 400, 'INVALID_MODEL', modelValidationError)
    const settings = await getSettings()
    await recordRejectedRequest({
      requestId,
      logicalModelId: null,
      clientProtocol: protocol,
      method,
      path,
      headers: req.headers,
      attributes,
      requestBody,
      captureRequestContent: settings.captureRequestContent,
      startedAt,
      status: 'failed',
      statusCode: 400,
      responseHeaders: res.getHeaders(),
      responseBody,
      hooks,
    })
    return
  }

  const requestedModel = (JSON.parse(requestBody.toString('utf8')) as { model: string }).model.trim()
  const logicalModels = await listLogicalModels()
  const requestedLogicalModel = logicalModels.find(model => model.enabled && (model.id === requestedModel || model.name === requestedModel))
  const resolvedLogicalModel = requestedLogicalModel ?? logicalModels.find(model => model.enabled && model.name === 'default')
  if (!resolvedLogicalModel) {
    console.error(`[proxy] no enabled logical model requestId=${requestId} requestedModel=${requestedModel}`)
    const responseBody = writeJsonError(res, 503, 'NO_MODEL_CONFIGURED', '还没有配置已启用的 default 逻辑模型')
    const settings = await getSettings()
    await recordRejectedRequest({
      requestId,
      logicalModelId: null,
      clientProtocol: protocol,
      method,
      path,
      headers: req.headers,
      attributes,
      requestBody,
      captureRequestContent: settings.captureRequestContent,
      startedAt,
      status: 'failed',
      statusCode: 503,
      responseHeaders: res.getHeaders(),
      responseBody,
      hooks,
    })
    return
  }
  logicalModelId = resolvedLogicalModel.id
  console.debug(`[proxy] logical model resolved requestId=${requestId} requestedModel=${requestedModel} logicalModelId=${logicalModelId} fallback=${requestedLogicalModel === undefined}`)

  const controller = new AbortController()
  req.once('aborted', () => controller.abort())
  res.once('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  const context = createRequestContext({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    method: req.method ?? 'POST',
    path: req.url ?? '/',
    headers: req.headers,
    attributes: collectRequestAttributes(req.headers),
    requestBody,
    signal: controller.signal,
  })

  const manualModelId = getManualModel(logicalModelId)
  const { availableModels, targets, manualModelUnavailable } = await resolveProxyTargets(logicalModelId, protocol)
  console.debug(`[proxy] routing resolved requestId=${requestId} logicalModelId=${logicalModelId} protocol=${protocol} manualModelId=${manualModelId ?? 'none'} availableModels=${availableModels.length} targets=${targets.length} targetOrder=${targets.map(target => target.model.id).join(',') || 'none'} manualModelUnavailable=${manualModelUnavailable}`)
  if (manualModelUnavailable) {
    console.warn(`[proxy] manual provider model unavailable requestId=${requestId} logicalModelId=${logicalModelId} protocol=${protocol}`)
    const responseBody = writeJsonError(res, 409, 'MANUAL_MODEL_UNAVAILABLE', '手动指定的 ProviderModel 当前不可用于该协议')
    const settings = await getSettings()
    await recordRejectedRequest({
      requestId,
      logicalModelId,
      clientProtocol: protocol,
      method,
      path,
      headers: req.headers,
      attributes,
      requestBody,
      captureRequestContent: settings.captureRequestContent,
      startedAt,
      status: 'failed',
      statusCode: 409,
      responseHeaders: res.getHeaders(),
      responseBody,
      hooks,
    })
    return
  }
  if (targets.length === 0) {
    const configuredProtocols = [...new Set(availableModels.flatMap(candidate => candidate.model.endpoints.map(endpoint => endpoint.protocol)))]
    const reason = availableModels.length === 0
      ? '该逻辑模型没有已启用且健康的供应商模型'
      : `可用供应商模型未配置 ${protocol} 协议且未开启协议转换（当前配置协议: ${configuredProtocols.join(', ') || '无'}）`
    const availableTargets = availableModels.length > 0
      ? `，已发现: ${availableModels.map(target => `${target.provider.name}/${target.model.modelName}`).join(', ')}`
      : ''
    console.warn(`[proxy] 没有可用的上游供应商: ${req.method} ${req.url} (protocol=${protocol}, logicalModel=${resolvedLogicalModel.name} [${logicalModelId}], requestId=${requestId}, reason=${reason}${availableTargets})`)
    const responseBody = writeJsonError(res, 503, 'NO_AVAILABLE_PROVIDER', `没有可用的上游 Provider：${reason}`)
    const settings = await getSettings()
    await recordRejectedRequest({
      requestId,
      logicalModelId,
      clientProtocol: protocol,
      method,
      path,
      headers: req.headers,
      attributes,
      requestBody,
      captureRequestContent: settings.captureRequestContent,
      startedAt,
      status: 'failed',
      statusCode: 503,
      responseHeaders: res.getHeaders(),
      responseBody,
      hooks,
    })
    return
  }

  console.debug(`[proxy] execution started requestId=${requestId} logicalModelId=${logicalModelId} targets=${targets.length}`)
  await executeProxyRequest({ context, targets, response: new NodeProxyResponse(res), hooks })
}

/** 写入一条被拒绝的请求记录：请求行 + 我们回给客户端的错误响应。 */
async function recordRejectedRequest(record: RejectedRequestRecord): Promise<void> {
  const logger = await initializeRequestLogger({
    requestId: record.requestId,
    logicalModelId: record.logicalModelId,
    clientProtocol: record.clientProtocol,
    method: record.method,
    path: record.path,
    headers: record.headers,
    attributes: record.attributes,
    requestBody: record.requestBody,
    captureRequestContent: record.captureRequestContent,
    hooks: record.hooks,
  })
  await logger.finalizeLocalErrorContent(record.statusCode, record.responseHeaders, record.responseBody)
  await logger.finalizeRequestLog(record.status, record.startedAt)
}

/** 写入一条被客户端中断的请求记录：没有响应写出，因此不写客户端正文的响应侧。 */
async function recordAbortedRequest(input: Omit<RejectedRequestRecord, 'captureRequestContent' | 'status' | 'statusCode' | 'responseHeaders' | 'responseBody'>): Promise<void> {
  const settings = await getSettings()
  const logger = await initializeRequestLogger({
    requestId: input.requestId,
    logicalModelId: input.logicalModelId,
    clientProtocol: input.clientProtocol,
    method: input.method,
    path: input.path,
    headers: input.headers,
    attributes: input.attributes,
    requestBody: input.requestBody,
    captureRequestContent: settings.captureRequestContent,
    hooks: input.hooks,
  })
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
