import http from 'node:http'
import { URL } from 'node:url'
import { markProviderSuccess, markProviderFailure, markProviderModelSuccess, markProviderModelFailure } from '@server/proxy/upstream/health'
import { getSettings } from '@server/database/settings-store'
import { findConvertibleEndpoint, findEndpoint, type ModelWithProvider } from '@server/proxy/routing/router'
import type { Protocol } from '@common/schemas'
import { isStreamingRequest, resolveUpstreamUrl } from '@server/proxy/request/request'
import { classifyHealthFailure, classifyUpstreamStatus } from '@server/proxy/response/response'
import type { HealthFailureScope } from '@server/proxy/response/response'
import { createAuthHeaders } from '@server/proxy/upstream/auth'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import { isOutboundProxyConnectionError } from '@server/infrastructure/network/outbound-connector'
import { createDownstreamHeaders, createUpstreamRequestHeaders, serializeCapturedHeaders } from '@server/proxy/response/headers'
import type { UpstreamStatusDisposition } from '@server/proxy/response/response'
import { attachResponseIdleTimeout, sendUpstreamRequest } from '@server/proxy/response/transport'
import { createRequestContext, type RequestContext } from '@server/proxy/request/request-context'
import { protocolAdapters } from '@server/proxy/protocols/registry'
import { ResponsePipeline } from '@server/proxy/response/response-pipeline'
import type { ProxyObservationHooks } from '@server/proxy/observability/hooks'
import { runAttempts } from '@server/proxy/execution/attempt-runner'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import { resolveAttemptSnapshot } from '@server/proxy/routing/routing'
import { listRulesForProviderModel } from '@server/database/request-rewrite-rule-store'
import { applyRequestRewriteRules, RequestRewriteError } from '@server/proxy/request-rewrite/request-rewrite-engine'
import { createAttemptLogger, initializeRequestLogger } from '@server/proxy/observability/logging'
import type { AttemptLogger, RequestContentOutcome } from '@server/proxy/observability/logging-types'

class ClientRequestCancelledError extends Error {
  readonly code = 'CLIENT_REQUEST_ABORTED'

  constructor() {
    super('客户端已取消请求')
    this.name = 'ClientRequestCancelledError'
  }
}

class RecordedAttemptError extends Error {
  readonly outcome: AttemptOutcome

  constructor(cause: Error, outcome: AttemptOutcome) {
    super(cause.message)
    this.name = 'RecordedAttemptError'
    this.cause = cause
    this.outcome = outcome
  }
}

/**
 * 本地错误：连接被拒、握手失败、请求超时、出站代理不可用。
 *
 * 上游一个字节都没回，因此没有任何「上游返回的内容」可记；但「这次尝试确实把请求
 * 发了出去」是事实，而真正发往上游的请求头与请求体只存在于这次尝试的日志器里。
 * 因此把日志器随错误一起交出去，让外层能用它补写上游视角，而不是写一个空壳。
 */
class LocalAttemptError extends Error {
  readonly cause: Error
  readonly attemptLogger: AttemptLogger

  constructor(cause: Error, attemptLogger: AttemptLogger) {
    super(cause.message)
    this.name = 'LocalAttemptError'
    this.cause = cause
    this.attemptLogger = attemptLogger
  }
}

/**
 * 本地失败的「上游视角响应」正文。
 *
 * 上游没有返回任何响应，所以状态码与响应头只能是 `null`；而排查这次失败最需要的
 * 恰恰是原因，因此把本地观察到的原因写进响应侧，并用 `localFailure` 标记它不是上游内容。
 */
function serializeLocalFailure(error: Error): string {
  return JSON.stringify({ localFailure: true, errorCode: 'UPSTREAM_ERROR', errorMessage: error.message })
}

function isClientRequestCancelled(error: unknown): boolean {
  return error instanceof ClientRequestCancelledError || (
    error instanceof Error && error.message === 'CLIENT_REQUEST_ABORTED'
  )
}

interface AttemptOutcome {
  disposition: UpstreamStatusDisposition
  statusCode: number
  durationMilliseconds: number
  errorCode?: string
  errorMessage?: string
  upstreamRequestId?: string | null
  ttftMilliseconds?: number
  /**
   * 真正发往上游的协议；只有发生了协议转换时非空。
   *
   * 仅用于日志：落库的上游协议取自尝试快照，没有这个可空语义。
   */
  upstreamProtocol?: Protocol | null
  /**
   * 上游返回的响应体原文。
   *
   * 这是「上游视角」的数据，只用于错误分类与健康度判定；写入客户端视角
   * 日志时必须使用 {@link AttemptOutcome.clientResponse}。
   */
  upstreamResponseBody?: string | null
  /**
   * 客户端视角的最终响应；仅当响应真正写出客户端时存在。
   * failover 中途放弃、请求改写被拒等场景下为 `undefined`。
   */
  clientResponse?: ClientResponseCapture | null
}

/** 一次尝试中真正返回给客户端的内容快照。 */
interface ClientResponseCapture {
  captureStatus: 'captured' | 'partial'
  /** 实际写出的响应头（脱敏后的 JSON 字符串）；未写出时为 `null`。 */
  responseHeaders: string | null
  /** 实际写出的响应体。 */
  responseBody: string | null
}

function formatTarget(target: ModelWithProvider): string {
  return `${target.provider.name}/${target.model.modelName} [providerId=${target.provider.id}, providerModelId=${target.model.id}]`
}

/**
 * 序列化已经真正写出到客户端的响应头。
 *
 * 只读 `response.headers()`：响应头尚未发出时返回 `null` —— 此时根本不存在
 * 「返回给客户端的响应」，不应用上游头回退值把它伪装成已返回。
 */
function serializeSentResponseHeaders(response: ProxyResponse): string | null {
  return serializeCapturedHeaders(response.headers())
}

/**
 * 把尝试结果中的客户端视角部分转换成请求级正文的写入入参。
 *
 * 状态码只在「响应真正写出客户端」时才回填；否则为 `null`，避免拿上游状态码
 * 冒充客户端看到的响应。
 */
function toRequestContentOutcome(outcome: AttemptOutcome): RequestContentOutcome {
  const capture = outcome.clientResponse
  return {
    perspective: 'client',
    statusCode: capture ? outcome.statusCode : null,
    captureStatus: capture?.captureStatus ?? 'partial',
    responseHeaders: capture?.responseHeaders ?? null,
    responseBody: capture?.responseBody ?? null,
  }
}

async function recordHealthFailure(target: ModelWithProvider, statusCode: number | null, responseBody?: string | null): Promise<HealthFailureScope> {
  const scope = classifyHealthFailure(statusCode, responseBody)
  if (scope === 'provider') await markProviderFailure(target.provider.id)
  if (scope === 'provider-model') await markProviderModelFailure(target.model.id)
  return scope
}

export interface ProxyExecutionOptions {
  context: RequestContext
  targets: ModelWithProvider[]
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
    captureRequestContent: settings.captureRequestContent,
    hooks,
  })
  // 回调放在落库之后：消费者在回调里回读这次请求时，行必须已经存在。
  await hooks.onRequestStarted?.(context)
  console.debug(`[proxy] attempt sequence started requestId=${requestId} targets=${targets.length} captureContent=${settings.captureRequestContent}`)
  await runAttempts<ModelWithProvider, AttemptOutcome>({
    signal: context.signal,
    targets,
    attempt: (target, attemptIndex) => attemptRequest(context, response, target, attemptIndex, hooks),
    onSuccess: async (target, outcome, attemptIndex) => {
      if (outcome.disposition === 'success') {
        console.info(
          `[proxy] request forwarded requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} upstreamProtocol=${outcome.upstreamProtocol ?? protocol} attempt=${attemptIndex} attempts=${attemptIndex + 1} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms totalDuration=${Date.now() - startedAt}ms`,
        )
        await markProviderSuccess(target.provider.id)
        await markProviderModelSuccess(target.model.id)
        await requestLogger.finalizeRequestContent(toRequestContentOutcome(outcome))
        // 用量不在请求级收尾里写：它随着「服务该请求的那次尝试」一起落库。
        await requestLogger.finalizeRequestLog('success', startedAt)
        return
      }
    },
    onTerminal: async (target, outcome, attemptIndex) => {
      console.warn(
        `[proxy] upstream request terminated without retry requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} attempts=${attemptIndex + 1} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms totalDuration=${Date.now() - startedAt}ms`,
      )
      await requestLogger.finalizeRequestContent(toRequestContentOutcome(outcome))
      await requestLogger.finalizeRequestLog('failed', startedAt)
    },
    onFailover: async (target, outcome, attemptIndex) => {
      const nextTarget = targets[attemptIndex + 1]
      const healthScope = await recordHealthFailure(target, outcome.statusCode, outcome.upstreamResponseBody)
      console.warn(
        `[proxy] upstream failover scheduled requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms nextProviderModelId=${nextTarget?.model.id ?? 'none'} healthFailureScope=${healthScope}`,
      )
    },
    onError: async (target, err, attemptIndex) => {
      // 本地失败外层只负责把「实际发往上游的请求」带出来；判断与分类仍按原始错误做。
      const localFailure = err instanceof LocalAttemptError ? err : null
      const rootError = localFailure ? localFailure.cause : err
      const lastError = err instanceof Error ? err : new Error(String(err))
      if (rootError instanceof RequestRewriteError) {
        console.warn(`[proxy] request rewrite rejected requestId=${requestId} providerModelId=${target.model.id} ruleId=${rootError.ruleId ?? 'unknown'} error=${rootError.message}`)
        if (!response.headersSent) {
          const responseBody = response.fail(422, rootError.code, rootError.message)
          // 响应体确实写给了客户端，就必须留证：否则这次失败在记录里只剩一个「failed」
          // 状态，看不出代理回了什么，也就无从判断客户端为什么报错。
          await requestLogger.finalizeLocalErrorContent(422, response.headers(), responseBody)
        }
        await requestLogger.finalizeRequestLog('failed', startedAt)
        return false
      }
      if (isClientRequestCancelled(rootError)) {
        console.debug(`[proxy] client request cancelled requestId=${requestId} attempt=${attemptIndex}`)
        try {
          const snapshot = resolveAttemptSnapshot(target, protocol)
          await createAttemptLogger({
            requestId,
            attemptIndex,
            startedAt,
            snapshot,
            upstreamRequestHeaders: {},
            upstreamRequestBody: Buffer.alloc(0),
            captureRequestContent: false,
            hooks: {},
          }).finalizeAttempt({
            status: 'cancelled',
            httpStatus: null,
            retryable: false,
            // 客户端取消时上游未必已响应，因此不知道上游是否在流式返回。
            streaming: null,
            // 客户端什么都没收到，因此不承担请求级用量。
            servesRequest: false,
            errorCode: 'CLIENT_REQUEST_ABORTED',
            errorMessage: lastError.message,
          })
        } catch (logError) {
          console.error(`[proxy] 写入取消请求尝试日志失败: ${(logError as Error).message}`)
        }
        await requestLogger.finalizeRequestLog('cancelled', startedAt)
        return false
      }
      const nextTarget = targets[attemptIndex + 1]
      console.warn(
        `[proxy] upstream attempt failed requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} failover=${!response.headersSent && nextTarget !== undefined} nextProviderModelId=${nextTarget?.model.id ?? 'none'} error=${lastError.message}`,
      )
      try {
        const snapshot = resolveAttemptSnapshot(target, protocol)
        if (!(err instanceof RecordedAttemptError)) {
          // 本地失败用这次尝试自己的日志器：只有它知道真正发往上游的请求头与请求体。
          // 换成空壳会让上游视角看起来像「什么都没发出去」。
          const attemptLogger = localFailure?.attemptLogger ?? createAttemptLogger({
            requestId,
            attemptIndex,
            startedAt,
            snapshot,
            upstreamRequestHeaders: {},
            upstreamRequestBody: Buffer.alloc(0),
            captureRequestContent: settings.captureRequestContent,
            hooks: {},
          })
          await attemptLogger.finalizeAttempt({
            status: 'failed',
            httpStatus: null,
            retryable: !response.headersSent,
            // 连接层面的失败往往连响应头都没拿到，无从判断上游是否在流式返回。
            streaming: null,
            servesRequest: false,
            errorCode: 'UPSTREAM_ERROR',
            errorMessage: lastError.message,
            upstreamContent: {
              captureStatus: 'partial',
              responseStatus: null,
              responseHeaders: null,
              responseBody: serializeLocalFailure(lastError),
            },
          })
        }
      } catch (logError) {
        console.error(`[proxy] 写入请求尝试日志失败: ${(logError as Error).message}`)
      }
      const recordedOutcome = err instanceof RecordedAttemptError ? err.outcome : null
      let healthScope: HealthFailureScope = 'none'
      if (!isOutboundProxyConnectionError(rootError)) {
        healthScope = await recordHealthFailure(target, recordedOutcome?.statusCode ?? null, recordedOutcome?.upstreamResponseBody)
      }
      if (healthScope !== 'none') {
        console.debug(
          `[proxy] health failure recorded requestId=${requestId} attempt=${attemptIndex} providerId=${target.provider.id} providerModelId=${target.model.id} scope=${healthScope} status=${recordedOutcome?.statusCode ?? 'none'}`,
        )
      }
      if (response.headersSent) {
        if (err instanceof RecordedAttemptError && err.outcome.clientResponse) {
          await requestLogger.finalizeRequestContent(toRequestContentOutcome({ ...err.outcome, clientResponse: err.outcome.clientResponse }))
        }
        response.destroy(lastError)
        await requestLogger.finalizeRequestLog('failed', startedAt)
        return false
      }
      return true
    },
    onCancelled: async (_target, attemptIndex) => {
      console.debug(`[proxy] request execution cancelled requestId=${requestId} attempt=${attemptIndex} attempts=${attemptIndex + 1} totalDuration=${Date.now() - startedAt}ms`)
      await requestLogger.finalizeRequestLog('cancelled', startedAt)
    },
    onExhausted: async lastError => {
      if (!response.headersSent) {
        console.error(
          `[proxy] all providers failed requestId=${requestId} method=${context.method} path=${context.path} clientProtocol=${protocol} logicalModelId=${logicalModelId} attempts=${targets.length} totalDuration=${Date.now() - startedAt}ms error=${lastError?.message ?? 'unknown'}`,
        )
        const responseBody = response.fail(
          502,
          'ALL_PROVIDERS_FAILED',
          lastError?.message ?? '所有 Provider 都失败了',
        )
        await requestLogger.finalizeLocalErrorContent(502, response.headers(), responseBody)
      }
      await requestLogger.finalizeRequestLog('failed', startedAt)
    },
  })
}

async function attemptRequest(context: RequestContext, response: ProxyResponse, target: ModelWithProvider, attemptIndex: number, hooks: ProxyObservationHooks): Promise<AttemptOutcome> {
  const { model, provider } = target
  const { requestId, logicalModelId, clientProtocol: protocol, requestBody } = context
  const settings = await getSettings()

  const nativeEndpoint = findEndpoint(model, protocol)
  const convertibleEndpoint = nativeEndpoint ? undefined : findConvertibleEndpoint(model, protocol)
  const endpoint = nativeEndpoint ?? convertibleEndpoint
  if (!endpoint) throw new Error(`模型 ${model.modelName} 不支持协议 ${protocol}`)
  const endpointProtocol = endpoint.protocol

  const targetUrl = resolveUpstreamUrl(endpoint.endpointUrl)
  const parsed = new URL(targetUrl)
  const controller = new AbortController()
  const requestContext = createRequestContext({
    requestId,
    logicalModelId,
    clientProtocol: protocol,
    method: context.method,
    path: context.path,
    headers: context.headers,
    requestBody,
    signal: controller.signal,
  })
  const adapter = protocolAdapters.resolve(protocol, endpointProtocol)
  const upstreamRequestBody = adapter.prepareRequest(requestContext, model.modelName)
  console.debug(`[proxy] attempt prepared requestId=${requestId} attempt=${attemptIndex} providerId=${provider.id} providerModelId=${model.id} clientProtocol=${protocol} upstreamProtocol=${endpointProtocol} conversion=${adapter.kind === 'conversion'} requestBytes=${requestBody.length} upstreamRequestBytes=${upstreamRequestBody.length} timeout=${provider.timeoutMilliseconds}ms`)
  const apiKey = await getSecretStore().get(provider.apiKeyReference)

  const isHttps = parsed.protocol === 'https:'

  const headers = createUpstreamRequestHeaders(
    context.headers,
    createAuthHeaders(endpointProtocol, apiKey, endpoint.customAuthHeader),
    upstreamRequestBody.length,
  )
  const rules = await listRulesForProviderModel(model.id)
  const modified = applyRequestRewriteRules(upstreamRequestBody, headers, rules, { stage: 'request', clientProtocol: protocol, upstreamProtocol: endpointProtocol })
  console.debug(`[proxy] request rewrite evaluated requestId=${requestId} attempt=${attemptIndex} providerModelId=${model.id} rules=${rules.length} applied=${modified.appliedRuleIds.length} skipped=${modified.skippedRuleIds.length} appliedRuleIds=${modified.appliedRuleIds.join(',') || 'none'} bodyBytesBefore=${upstreamRequestBody.length} bodyBytesAfter=${modified.body.length}`)

  const options: http.RequestOptions = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: context.method,
    headers: modified.headers,
    timeout: provider.timeoutMilliseconds,
    signal: controller.signal,
  }

  const attemptStartedAt = Date.now()
  const snapshot = resolveAttemptSnapshot(target, protocol)
  const attemptLogger = createAttemptLogger({
    requestId,
    attemptIndex,
    startedAt: attemptStartedAt,
    snapshot,
    upstreamRequestHeaders: modified.headers,
    upstreamRequestBody: modified.body,
    requestRewriteRuleIds: modified.appliedRuleIds,
    customAuthHeader: endpoint.customAuthHeader,
    captureRequestContent: settings.captureRequestContent,
    hooks,
  })
  const { finalizeAttempt } = attemptLogger

  return new Promise<AttemptOutcome>((resolve, reject) => {
    let settled = false
    let downstreamAbort: { dispose(): void } | null = null
    const cleanupClientListeners = () => downstreamAbort?.dispose()
    const rejectCancelled = () => {
      if (settled) return
      settled = true
      cleanupClientListeners()
      reject(new ClientRequestCancelledError())
    }
    const onAbort = () => {
      controller.abort()
      rejectCancelled()
    }

    if (context.signal.aborted || response.destroyed) {
      rejectCancelled()
      return
    }

    const rejectAttempt = (error: Error) => {
      if (settled) return
      settled = true
      cleanupClientListeners()
      reject(error)
    }
    const resolveAttempt = (outcome: AttemptOutcome) => {
      if (settled) return
      settled = true
      cleanupClientListeners()
      resolve(outcome)
    }

    sendUpstreamRequest(parsed, options, modified.body, {
      onResponse: upstreamRes => {
      const statusCode = upstreamRes.statusCode ?? 502
      const disposition = classifyUpstreamStatus(statusCode)

      // TTFT 由响应管线记录，Prompt Cache 仅从响应 usage 读取。
      let ttftMilliseconds: number | undefined
      let responseBody = ''
      const upstreamChunks: string[] = []
      const upstreamRequestId = extractUpstreamRequestId(upstreamRes.headers)

      const contentType = String(upstreamRes.headers['content-type'] ?? '')
      // 「上游是否以 SSE 返回」是本次尝试的事实，直接写入尝试行。
      const upstreamStreaming = contentType.includes('text/event-stream')
      // 「是否按流式交付下发给客户端」是响应管线的语义，需要客户端也要求了流式。
      const isStreaming = isStreamingRequest(requestBody) && upstreamStreaming
      console.debug(`[proxy] upstream response received requestId=${requestId} attempt=${attemptIndex} providerModelId=${model.id} status=${statusCode} disposition=${disposition} streaming=${isStreaming} upstreamStreaming=${upstreamStreaming} upstreamRequestIdPresent=${upstreamRequestId !== null} responseLatency=${Date.now() - attemptStartedAt}ms`)

      if (disposition === 'failover') {
        const idleTimeout = attachResponseIdleTimeout(upstreamRes, settings.idleTimeoutMilliseconds)
        upstreamRes.on('data', chunk => {
          const chunkText = chunk.toString('utf8')
          if (settings.captureRequestContent) upstreamChunks.push(chunkText)
          responseBody += chunkText
        })
        upstreamRes.on('end', async () => {
          idleTimeout.dispose()
          // 已经结束（客户端取消）就不再把这次尝试写成新事实。
          if (settled) return
          const body = responseBody || null
          const resolvedRequestId = upstreamRequestId ?? extractRequestIdFromBody(body)
          await finalizeAttempt({
            status: 'failed',
            httpStatus: statusCode,
            retryable: true,
            streaming: upstreamStreaming,
            // 本次尝试已被放弃，客户端未收到任何响应，因此不承担请求级用量。
            servesRequest: false,
            errorCode: `Status_${statusCode}`,
            errorMessage: `上游返回 ${statusCode}`,
            upstreamRequestId: resolvedRequestId,
            upstreamContent: {
              captureStatus: 'captured',
              responseStatus: statusCode,
              responseHeaders: upstreamRes.headers,
              responseBody: serializeCapturedBody(isStreaming, upstreamChunks, body),
            },
          })
          // 本次尝试已被放弃，客户端未收到任何响应，因此不携带 clientResponse。
          resolveAttempt({ disposition: 'failover', statusCode, durationMilliseconds: Date.now() - attemptStartedAt, upstreamRequestId: resolvedRequestId, upstreamResponseBody: body })
        })
        upstreamRes.on('error', err => {
          idleTimeout.dispose()
          if (settled) return
          void (async () => {
            await finalizeAttempt({
              status: 'failed',
              httpStatus: statusCode,
              retryable: true,
              streaming: upstreamStreaming,
              servesRequest: false,
              errorCode: 'UPSTREAM_STREAM_ERROR',
              errorMessage: err.message,
              upstreamRequestId,
              upstreamContent: {
                captureStatus: 'partial',
                responseStatus: statusCode,
                responseHeaders: upstreamRes.headers,
                responseBody: serializeCapturedBody(isStreaming, upstreamChunks, responseBody || null),
              },
            })
            rejectAttempt(new RecordedAttemptError(err, {
              disposition: 'failover',
              statusCode,
              durationMilliseconds: Date.now() - attemptStartedAt,
              upstreamRequestId: upstreamRequestId,
              upstreamResponseBody: serializeCapturedBody(isStreaming, upstreamChunks, responseBody || null),
            }))
          })()
        })
        upstreamRes.resume()
        return
      }

      const idleTimeout = attachResponseIdleTimeout(upstreamRes, settings.idleTimeoutMilliseconds)

      const downstreamHeaders = createDownstreamHeaders(upstreamRes.headers)
      if (adapter.kind === 'conversion' || !isStreaming) delete downstreamHeaders['content-length']
      if (isStreaming && !response.headersSent) response.start(statusCode, downstreamHeaders)
      let responseRewriteAppliedRuleIds: string[] = []
      let responseRewriteSkippedRuleIds: string[] = []

      const responsePipeline = new ResponsePipeline({
        adapter,
        isStreaming,
        captureEnabled: settings.captureRequestContent,
        onFirstOutput: () => {
          if (isStreaming && ttftMilliseconds === undefined) {
            ttftMilliseconds = Date.now() - attemptStartedAt
          }
        },
        response,
        upstreamHeaders: downstreamHeaders,
        onStart: headers => { if (!response.headersSent) response.start(statusCode, headers) },
        transformResponse: !isStreaming ? (body, headers) => {
          const modifiedResponse = applyRequestRewriteRules(body, headers, rules, {
            stage: 'response',
            clientProtocol: protocol,
            upstreamProtocol: endpointProtocol,
            streaming: false,
          })
          responseRewriteAppliedRuleIds = modifiedResponse.appliedRuleIds
          responseRewriteSkippedRuleIds = modifiedResponse.skippedRuleIds
          return { body: modifiedResponse.body, headers: modifiedResponse.headers }
        } : undefined,
        onConversionError: error => {
          console.warn(`[proxy] response conversion failed requestId=${requestId} attempt=${attemptIndex} providerModelId=${model.id} clientProtocol=${protocol} upstreamProtocol=${endpointProtocol} streaming=${isStreaming} error=${error.message}`)
        },
        onUsage: () => undefined,
        onUpstreamChunk: () => undefined,
        onDownstreamChunk: () => undefined,
      })

      upstreamRes.on('data', chunk => {
        const chunkText = chunk.toString('utf8')
        if (disposition !== 'success') {
          responseBody += chunkText
        }
        responsePipeline.push(chunkText, disposition === 'success')
      })

      upstreamRes.on('end', async () => {
        idleTimeout.dispose()
        // 已经结束（客户端取消）就不再把这次尝试写成新事实：取消路径已经落过一行。
        if (settled) return

        const pipelineResult = responsePipeline.finish(disposition === 'success', disposition === 'success' ? null : (responseBody || null))
        console.debug(`[proxy] response rewrite evaluated requestId=${requestId} attempt=${attemptIndex} providerModelId=${model.id} streaming=${isStreaming} skippedForStreaming=${isStreaming} rules=${rules.length} applied=${responseRewriteAppliedRuleIds.length} skipped=${isStreaming ? rules.length : responseRewriteSkippedRuleIds.length} appliedRuleIds=${responseRewriteAppliedRuleIds.join(',') || 'none'}`)
        const resolvedBody = disposition === 'success' ? pipelineResult.upstreamBody : (responseBody || null)
        const resolvedRequestId = upstreamRequestId ?? extractRequestIdFromBody(resolvedBody)
        await finalizeAttempt({
          status: disposition === 'success' ? 'success' : 'failed',
          httpStatus: statusCode,
          retryable: false,
          streaming: upstreamStreaming,
          // 响应已经写出客户端（或已经开始写），因此它就是服务这个请求的那次尝试。
          servesRequest: true,
          errorCode: disposition === 'success' ? undefined : `Status_${statusCode}`,
          errorMessage: disposition === 'success' ? undefined : `上游返回 ${statusCode}`,
          upstreamRequestId: resolvedRequestId,
          usage: pipelineResult.usage,
          upstreamContent: {
            captureStatus: 'captured',
            responseStatus: statusCode,
            responseHeaders: upstreamRes.headers,
            responseBody: pipelineResult.upstreamBody,
          },
          responseRewriteRuleIds: responseRewriteAppliedRuleIds,
          ttftMilliseconds: ttftMilliseconds ?? null,
        })
        resolveAttempt({
          disposition,
          statusCode,
          durationMilliseconds: Date.now() - attemptStartedAt,
          upstreamRequestId: resolvedRequestId,
          ttftMilliseconds,
          upstreamProtocol: adapter.kind === 'conversion' ? endpointProtocol : null,
          upstreamResponseBody: disposition === 'success' ? pipelineResult.upstreamBody : resolvedBody,
          clientResponse: {
            captureStatus: 'captured',
            responseHeaders: serializeSentResponseHeaders(response),
            responseBody: pipelineResult.downstreamBody,
          },
        })
      })

      upstreamRes.on('error', err => {
        idleTimeout.dispose()
        if (settled) return
        void (async () => {
          await finalizeAttempt({
            status: 'failed',
            httpStatus: statusCode,
            retryable: false,
            streaming: upstreamStreaming,
            // 响应已经开始写出客户端，部分内容已经到达，因此它仍然是服务这个请求的尝试。
            servesRequest: true,
            errorCode: 'UPSTREAM_STREAM_ERROR',
            errorMessage: err.message,
            upstreamRequestId,
            usage: responsePipeline.getUsage(),
            upstreamContent: {
              captureStatus: 'partial',
              responseStatus: statusCode,
              responseHeaders: upstreamRes.headers,
              responseBody: responsePipeline.partialBody(),
            },
            responseRewriteRuleIds: responseRewriteAppliedRuleIds,
            ttftMilliseconds: ttftMilliseconds ?? null,
          })
          rejectAttempt(new RecordedAttemptError(err, {
            disposition,
            statusCode,
            durationMilliseconds: Date.now() - attemptStartedAt,
            upstreamRequestId: upstreamRequestId,
            upstreamResponseBody: responsePipeline.partialBody(),
            clientResponse: {
              captureStatus: 'partial',
              responseHeaders: serializeSentResponseHeaders(response),
              responseBody: responsePipeline.partialDownstreamBody(),
            },
          }))
        })()
      })
      },
      onError: err => {
        if (err.name === 'AbortError' || controller.signal.aborted) {
          rejectCancelled()
          return
        }
        rejectAttempt(new LocalAttemptError(err, attemptLogger))
      },
      onTimeout: request => request.destroy(new Error('Connection timeout')),
    })
    const abortListener = () => onAbort()
    context.signal.addEventListener('abort', abortListener, { once: true })
    downstreamAbort = { dispose: () => context.signal.removeEventListener('abort', abortListener) }

  })
}

function serializeStreamingChunks(chunks: string[]): string {
  return JSON.stringify({ schemaVersion: 1, chunks })
}

function serializeCapturedBody(isStreaming: boolean, chunks: string[], body: string | null): string | null {
  return isStreaming ? serializeStreamingChunks(chunks) : body
}

function extractUpstreamRequestId(headers: http.IncomingHttpHeaders): string | null {
  const candidates = [
    headers['x-request-id'],
    headers['request-id'],
    headers['anthropic-request-id'],
    headers['x-correlation-id'],
    headers['x-amzn-requestid'],
    headers['x-goog-request-id'],
  ]
  for (const value of candidates) {
    const id = Array.isArray(value) ? value[0] : value
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return null
}

export function extractRequestIdFromBody(body: string | null): string | null {
  if (!body) return null

  // 普�?JSON 响应：兼容成功响应、错误响应以�?Provider 自己的嵌套结构�?
  const directId = parseRequestIdJson(body)
  if (directId) return directId

  // 流式响应的捕获内容是 { schemaVersion, chunks }，每�?chunk 可能包含多个 SSE event�?
  try {
    const captured = JSON.parse(body) as Record<string, unknown>
    if (Array.isArray(captured.chunks)) {
      for (const chunk of captured.chunks) {
        if (typeof chunk !== 'string') continue
        const id = extractRequestIdFromSse(chunk)
        if (id) return id
      }
    }
  } catch {
    // �?JSON body 可能仍然是原�?SSE 文本，继续按 SSE 解析�?
  }

  return extractRequestIdFromSse(body)
}

function parseRequestIdJson(body: string): string | null {
  try {
    return findRequestId(JSON.parse(body))
  } catch {
    return null
  }
}

export function extractRequestIdFromSse(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const data = line.trim().replace(/^data:\s*/, '')
    if (!data || data === '[DONE]') continue
    const id = parseRequestIdJson(data)
    if (id) return id
  }
  return null
}

function findRequestId(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findRequestId(item, depth + 1)
      if (id) return id
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of ['request_id', 'requestId', 'id']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  for (const child of Object.values(record)) {
    const id = findRequestId(child, depth + 1)
    if (id) return id
  }
  return null
}
