import { getSettings } from '@server/database/settings-store'
import { classifyUpstreamStatus } from '@server/proxy/response/response'
import type { UpstreamStatusDisposition } from '@server/proxy/response/response'
import { createProtocolAuthHeaders } from '@common/protocols'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { createRequestContext, type RequestContext } from '@server/proxy/request/request-context'
import { protocolAdapters } from '@server/proxy/protocols/registry'
import type { ProxyObservationHooks } from '@server/proxy/observability/hooks'
import { runAttempts } from '@server/proxy/execution/attempt-runner'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import { listRulesForProviderModel } from '@server/database/request-rewrite-rule-store'
import { createAttemptLogger, initializeRequestLogger } from '@server/proxy/observability/logging'
import type { AttemptView, ExchangeView, UpstreamTarget } from '@server/proxy/contracts'
import { createHttpResponseSink, isEventStreamResponse } from '@server/proxy/adapters/http-response-sink'
import { resolveTransportImplementation } from '@server/proxy/transports/registry'
import { resolveUpstreamTransport } from '@server/proxy/routing/upstream-url'
import type { TransportKind } from '@common/schemas'
import { createAttemptObserver } from '@server/proxy/observers/attempt-observer'
import { createRequestModifiers, type RewriteEvaluation } from '@server/proxy/modifiers/request-modifiers'
import { createResponseModifiers, type AttemptRouting } from '@server/proxy/modifiers/response-modifiers'
import { relayAttempt } from '@server/proxy/kernel/relay'
import { pipeBuffered } from '@server/proxy/kernel/buffered-pipe'
import { ClientRequestCancelledError, isClientRequestCancelled, LocalAttemptError } from './attempt-errors'
import type { AttemptOutcome } from './attempt-outcome'
import { concludeDeliveredAttempt, concludeInterruptedAttempt, concludeUndeliverableAttempt, type AttemptConclusionInput } from './attempt-conclusion'
import { createRequestFinalizer } from './request-finalizer'
import { extractUpstreamRequestId } from './request-id'

export interface ProxyExecutionOptions {
  context: RequestContext
  /** 这次要依次尝试的上游，由规划器给出（顺序即优先级）。 */
  targets: readonly UpstreamTarget[]
  response: ProxyResponse
  hooks?: ProxyObservationHooks
}

export async function executeProxyRequest(options: ProxyExecutionOptions): Promise<void> {
  const { context, targets, response, hooks = {} } = options
  const { requestId, logicalModelId, clientProtocol: protocol, requestBody } = context
  const startedAt = Date.now()
  const settings = await getSettings()
  const requestLogger = await initializeRequestLogger({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    method: context.method,
    path: context.path,
    headers: context.headers,
    attributes: context.attributes,
    requestBody,
    transport: context.transport,
    captureRequestLogs: settings.captureRequestLogs,
    captureRequestContent: settings.captureRequestContent,
    hooks,
  })
  // 回调放在落库之后：消费者在回调里回读这次请求时，行必须已经存在。
  await hooks.onRequestStarted?.(context)
  console.debug(`[proxy] attempt sequence started requestId=${requestId} targets=${targets.length} captureContent=${settings.captureRequestContent}`)
  const finalizer = createRequestFinalizer({
    context,
    targets,
    response,
    requestLogger,
    captureRequestContent: settings.captureRequestContent,
    startedAt,
  })
  await runAttempts<UpstreamTarget, AttemptOutcome>({
    signal: context.signal,
    targets,
    attempt: (target, attemptIndex) => attemptRequest(context, response, target, attemptIndex, hooks),
    onSuccess: finalizer.onSuccess,
    onTerminal: finalizer.onTerminal,
    onFailover: finalizer.onFailover,
    onError: finalizer.onError,
    onCancelled: finalizer.onCancelled,
    onExhausted: finalizer.onExhausted,
  })
}

/**
 * 一次尝试：把客户端请求交给上游，再把上游响应交给客户端。
 *
 * 这里只剩「编排」：拼一次尝试需要的修改器、观察者、出口，然后交给内核搬运。
 * 协议差异在适配器里，报文改写与转换在修改器里，落库与观测在观察者与日志器里，
 * 字节搬运在帧管道里，「发往哪里」在规划器里——因此这个函数里没有任何 `http` 细节，
 * 没有任何协议分支，也没有任何路由判断。
 */
async function attemptRequest(context: RequestContext, response: ProxyResponse, target: UpstreamTarget, attemptIndex: number, hooks: ProxyObservationHooks): Promise<AttemptOutcome> {
  const { requestId, logicalModelId, clientProtocol: protocol, requestBody } = context
  const settings = await getSettings()
  const endpointProtocol = target.protocol

  // 尝试级的取消信号：客户端断开与这次尝试自己的中止都打在它上面，传输层只认这一个信号。
  const controller = new AbortController()
  const abortAttempt = () => controller.abort()
  if (context.signal.aborted || response.destroyed) throw new ClientRequestCancelledError()
  context.signal.addEventListener('abort', abortAttempt, { once: true })

  try {
    const requestContext = createRequestContext({
      requestId,
      logicalModelId,
      clientProtocol: protocol,
      transport: context.transport,
      method: context.method,
      path: context.path,
      headers: context.headers,
      requestBody,
      signal: controller.signal,
    })
    const adapter = protocolAdapters.resolve(protocol, endpointProtocol)
    const apiKey = await getSecretStore().get(target.apiKeyReference)
    const rules = await listRulesForProviderModel(target.providerModelId)

    const attempt: AttemptView = { index: attemptIndex, endpointId: target.endpointId, endpointProtocol }
    const exchange: ExchangeView = {
      requestId,
      logicalModelId,
      clientProtocol: protocol,
      transport: context.transport,
      method: context.method,
      path: context.path,
      headers: context.headers,
      body: requestBody,
      signal: controller.signal,
    }
    const routing: AttemptRouting = { deliverable: false, successful: false }
    const attemptStartedAt = Date.now()
    const requestEvaluation: RewriteEvaluation = { appliedRuleIds: [], skippedRuleIds: [], bodyBytesBefore: requestBody.length, bodyBytesAfter: requestBody.length }
    const responseEvaluation: RewriteEvaluation = { appliedRuleIds: [], skippedRuleIds: [], bodyBytesBefore: 0, bodyBytesAfter: 0 }
    const observer = createAttemptObserver({
      exchange,
      attempt,
      captureEnabled: settings.captureRequestContent,
      startedAt: attemptStartedAt,
    })
    const sink = createHttpResponseSink({
      response,
      transport: context.transport,
      captureEnabled: settings.captureRequestContent,
    })

    const requestModifiers = createRequestModifiers({
      adapter,
      requestContext,
      providerModelName: target.providerModelName,
      authHeaders: createProtocolAuthHeaders(endpointProtocol, apiKey, target.customAuthHeader),
      rules,
      onRewriteEvaluated: result => { Object.assign(requestEvaluation, result) },
    })
    const responseModifiers = createResponseModifiers({
      adapter,
      routing,
      rules,
      onRewriteEvaluated: result => { Object.assign(responseEvaluation, result) },
      onConversionError: error => {
        console.warn(`[proxy] response conversion failed requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} clientProtocol=${protocol} upstreamProtocol=${endpointProtocol} transport=${context.transport} error=${error.message}`)
      },
    })

    const requestPipe = await pipeBuffered({
      payload: { body: requestBody, headers: context.headers },
      context: { exchange, attempt, direction: 'request', clientProtocol: protocol, upstreamProtocol: endpointProtocol, upstreamHead: null },
      modifiers: requestModifiers,
    })
    if (!requestPipe.payload) throw new Error(`The request was dropped by a request modifier before forwarding: ${target.providerModelName}`)
    const prepared = requestPipe.payload

    console.debug(`[proxy] attempt prepared requestId=${requestId} attempt=${attemptIndex} providerId=${target.providerId} providerModelId=${target.providerModelId} clientProtocol=${protocol} upstreamProtocol=${endpointProtocol} conversion=${adapter.kind === 'conversion'} requestBytes=${requestBody.length} upstreamRequestBytes=${prepared.body.length} timeout=${target.timeoutMilliseconds}ms`)
    console.debug(`[proxy] request rewrite evaluated requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} rules=${rules.length} applied=${requestEvaluation.appliedRuleIds.length} skipped=${requestEvaluation.skippedRuleIds.length} appliedRuleIds=${requestEvaluation.appliedRuleIds.join(',') || 'none'} bodyBytesBefore=${requestEvaluation.bodyBytesBefore} bodyBytesAfter=${requestEvaluation.bodyBytesAfter}`)

    const attemptLogger = createAttemptLogger({
      requestId,
      attemptIndex,
      startedAt: attemptStartedAt,
      target,
      upstreamRequestHeaders: prepared.headers,
      upstreamRequestBody: prepared.body,
      requestRewriteRuleIds: requestEvaluation.appliedRuleIds,
      customAuthHeader: target.customAuthHeader,
      captureRequestContent: settings.captureRequestContent,
      hooks,
    })

    // 上游跳的形态来自端点地址的 scheme（`wss://` 就是 websocket），其余情况与客户端跳同形——
    // 代理只做忠诚转发，不会因为客户端想收增量就给上游换成另一种形态。
    const transport = resolveTransportImplementation({
      transport: resolveUpstreamTransport(target.url, context.transport),
      resolveIdleTimeoutMilliseconds: () => settings.idleTimeoutMilliseconds,
    })

    let statusCode = 502
    let disposition: UpstreamStatusDisposition = 'terminal'
    let upstreamTransport: TransportKind | null = null
    /** 客户端跳要求的形态没有被上游跳兼现（要 `http-stream` 却回了非 SSE 的 2xx）。 */
    let transportMismatch = false
    let upstreamRequestId: string | null = null
    const relay = await relayAttempt({
      exchange,
      request: { ...exchange, body: prepared.body, headers: prepared.headers },
      attempt,
      target,
      transport,
      sink,
      modifiers: responseModifiers,
      observers: [observer],
      startedAt: attemptStartedAt,
      // 交付决策必须早于任何字节落地：failover 的响应一个字节都不该给客户端，
      // 因此这里一旦判定不交付，立刻让出口进入丢弃态，后续帧只喂观察者。
      onHead: head => {
        statusCode = head.status
        upstreamTransport = isEventStreamResponse(head.headers) ? 'http-stream' : 'http'
        disposition = classifyUpstreamStatus(statusCode)
        // 期望与事实的落差：客户端跳要求增量交付，上游跳却回了一个非 SSE 的 2xx。
        //
        // 代理只做忠诚转发：既不替上游补做形态的转换，也不把整包 JSON 硬塞进流式响应——
        // 那种「看起来能用」的响应只是把上游违约藏起来，客户端拿到的是一个 SSE 语义下的 JSON
        // 字节流，而日志里看不出任何异常（§1.2）。因此它不是成功，而是一次失败：
        // 按切换策略处理，让下一个候选来接。
        transportMismatch = disposition === 'success' && context.transport === 'http-stream' && upstreamTransport !== 'http-stream'
        if (transportMismatch) {
          disposition = 'failover'
          console.warn(`[proxy] transport mismatch requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} transport=${context.transport} upstreamTransport=${upstreamTransport} upstreamContentType=${String(head.headers['content-type'] ?? '')}`)
        }
        routing.successful = disposition === 'success'
        routing.deliverable = disposition !== 'failover'
        if (!routing.deliverable) sink.discard()
        upstreamRequestId = extractUpstreamRequestId(head.headers)
        console.debug(`[proxy] upstream response received requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} status=${statusCode} disposition=${disposition} transport=${context.transport} transportMismatch=${transportMismatch} upstreamTransport=${upstreamTransport} upstreamRequestIdPresent=${upstreamRequestId !== null} responseLatency=${Date.now() - attemptStartedAt}ms`)
      },
    }).catch(error => {
      if (isClientRequestCancelled(error)) throw new ClientRequestCancelledError()
      throw error instanceof Error ? new LocalAttemptError(error, attemptLogger) : new LocalAttemptError(new Error(String(error)), attemptLogger)
    })

    const durationMilliseconds = Date.now() - attemptStartedAt
    const failure = relay.error
    // 客户端取消优先于一切：搬运被中止且原因是客户端断开时，这次尝试不该记成上游故障。
    if (isClientRequestCancelled(failure) || (failure === null && !relay.ended && context.signal.aborted)) {
      throw new ClientRequestCancelledError()
    }
    if (failure !== null && relay.head === null) throw new LocalAttemptError(failure, attemptLogger)

    const conclusion: AttemptConclusionInput = {
      attemptLogger,
      observer,
      sink,
      response,
      statusCode,
      disposition,
      upstreamTransport,
      transportMismatch,
      upstreamRequestId,
      durationMilliseconds,
      upstreamProtocol: adapter.kind === 'conversion' ? endpointProtocol : null,
      responseRewriteRuleIds: responseEvaluation.appliedRuleIds,
    }
    if (failure !== null) {
      // 上游已经发过响应头，搬运中途断了：按「这次尝试是否已经交付过内容」收尾，
      // 再交给外层决定销毁响应还是继续 failover。
      await concludeInterruptedAttempt({ ...conclusion, failure, deliverable: routing.deliverable })
    }
    if (!routing.deliverable) return await concludeUndeliverableAttempt(conclusion)

    // 响应改写只作用于 `http` 这种整包形态（见 `createResponseRewriteModifier` 的 `scope`）：
    // 增量交付时它根本没被选中，因此这里分开记，免得日志里出现一排「0 条命中」的假评估。
    if (context.transport === 'http-stream') {
      console.debug(`[proxy] response rewrite skipped requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} transport=http-stream rules=${rules.length} reason=modifier-not-applicable`)
    } else {
      console.debug(`[proxy] response rewrite evaluated requestId=${requestId} attempt=${attemptIndex} providerModelId=${target.providerModelId} transport=${context.transport} rules=${rules.length} applied=${responseEvaluation.appliedRuleIds.length} skipped=${responseEvaluation.skippedRuleIds.length} appliedRuleIds=${responseEvaluation.appliedRuleIds.join(',') || 'none'}`)
    }
    return await concludeDeliveredAttempt(conclusion)
  } finally {
    context.signal.removeEventListener('abort', abortAttempt)
  }
}
