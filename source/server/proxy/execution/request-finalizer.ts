import { isOutboundProxyConnectionError } from '@server/infrastructure/network/outbound-connector'
import { markProviderModelSuccess, markProviderSuccess } from '@server/proxy/upstream/health'
import { createAttemptLogger } from '@server/proxy/observability/logging'
import type { RequestLogger } from '@server/proxy/observability/logging-types'
import { RequestRewriteError } from '@server/proxy/request-rewrite/request-rewrite-engine'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import type { HealthFailureScope } from '@server/proxy/response/response'
import type { UpstreamTarget } from '@server/proxy/contracts'
import type { RequestContext } from '@server/proxy/request/request-context'
import { isClientRequestCancelled, LocalAttemptError, RecordedAttemptError, serializeLocalFailure } from './attempt-errors'
import { formatTarget, recordHealthFailure, toRequestContentOutcome, type AttemptOutcome } from './attempt-outcome'

export interface RequestFinalizerOptions {
  context: RequestContext
  /** 计划中的全部上游，顺序即优先级；收尾只看「下一个是谁」。 */
  targets: readonly UpstreamTarget[]
  response: ProxyResponse
  requestLogger: RequestLogger
  captureRequestContent: boolean
  startedAt: number
}

/**
 * 请求级收尾。
 *
 * 每种结局只有一件事要做：把「这次请求最后是什么结果」写进日志与健康度。因此这里
 * 集中了全部结局分支——执行器只负责按顺序试、试完把结局交给这里，不再自己决定
 * 什么该落库。副作用固定的顺序也在这里保持不变：先落尝试正文，再落请求状态。
 */
export interface RequestFinalizer {
  onSuccess(target: UpstreamTarget, outcome: AttemptOutcome, attemptIndex: number): Promise<void>
  onTerminal(target: UpstreamTarget, outcome: AttemptOutcome, attemptIndex: number): Promise<void>
  onFailover(target: UpstreamTarget, outcome: AttemptOutcome, attemptIndex: number): Promise<void>
  onError(target: UpstreamTarget, error: unknown, attemptIndex: number): Promise<boolean>
  onCancelled(target: UpstreamTarget, attemptIndex: number): Promise<void>
  onExhausted(lastError: Error | null): Promise<void>
}

export function createRequestFinalizer(options: RequestFinalizerOptions): RequestFinalizer {
  const { context, targets, response, requestLogger, captureRequestContent, startedAt } = options
  const { requestId, logicalModelId, clientProtocol: protocol } = context

  return {
    onSuccess: async (target, outcome, attemptIndex) => {
      if (outcome.disposition === 'success') {
        console.info(
          `[proxy] request forwarded requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} upstreamProtocol=${outcome.upstreamProtocol ?? protocol} attempt=${attemptIndex} attempts=${attemptIndex + 1} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms totalDuration=${Date.now() - startedAt}ms`,
        )
        await markProviderSuccess(target.providerId)
        await markProviderModelSuccess(target.providerModelId)
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
        `[proxy] upstream failover scheduled requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} status=${outcome.statusCode} duration=${outcome.durationMilliseconds}ms nextProviderModelId=${nextTarget?.providerModelId ?? 'none'} healthFailureScope=${healthScope}`,
      )
    },

    onError: async (target, error, attemptIndex) => {
      // 本地失败外层只负责把「实际发往上游的请求」带出来；判断与分类仍按原始错误做。
      const localFailure = error instanceof LocalAttemptError ? error : null
      const rootError = localFailure ? localFailure.cause : error
      const lastError = error instanceof Error ? error : new Error(String(error))
      if (rootError instanceof RequestRewriteError) {
        console.warn(`[proxy] request rewrite rejected requestId=${requestId} providerModelId=${target.providerModelId} ruleId=${rootError.ruleId ?? 'unknown'} error=${rootError.message}`)
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
          await createAttemptLogger({
            requestId,
            attemptIndex,
            startedAt,
            target,
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
        `[proxy] upstream attempt failed requestId=${requestId} method=${context.method} path=${context.path} target=${formatTarget(target)} clientProtocol=${protocol} attempt=${attemptIndex} failover=${!response.headersSent && nextTarget !== undefined} nextProviderModelId=${nextTarget?.providerModelId ?? 'none'} error=${lastError.message}`,
      )
      try {
        if (!(error instanceof RecordedAttemptError)) {
          // 本地失败用这次尝试自己的日志器：只有它知道真正发往上游的请求头与请求体。
          // 换成空壳会让上游视角看起来像「什么都没发出去」。
          const attemptLogger = localFailure?.attemptLogger ?? createAttemptLogger({
            requestId,
            attemptIndex,
            startedAt,
            target,
            upstreamRequestHeaders: {},
            upstreamRequestBody: Buffer.alloc(0),
            captureRequestContent,
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
      const recordedOutcome = error instanceof RecordedAttemptError ? error.outcome : null
      let healthScope: HealthFailureScope = 'none'
      if (!isOutboundProxyConnectionError(rootError)) {
        healthScope = await recordHealthFailure(target, recordedOutcome?.statusCode ?? null, recordedOutcome?.upstreamResponseBody)
      }
      if (healthScope !== 'none') {
        console.debug(
          `[proxy] health failure recorded requestId=${requestId} attempt=${attemptIndex} providerId=${target.providerId} providerModelId=${target.providerModelId} scope=${healthScope} status=${recordedOutcome?.statusCode ?? 'none'}`,
        )
      }
      if (response.headersSent) {
        if (error instanceof RecordedAttemptError && error.outcome.clientResponse) {
          await requestLogger.finalizeRequestContent(toRequestContentOutcome(error.outcome))
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
  }
}
