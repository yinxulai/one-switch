import type { Protocol } from '@common/schemas'
import type { HttpResponseSink } from '@server/proxy/adapters/http-response-sink'
import type { AttemptObserver } from '@server/proxy/observers/attempt-observer'
import type { AttemptLogger, UpstreamContentInput } from '@server/proxy/observability/logging-types'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'
import type { UpstreamStatusDisposition } from '@server/proxy/response/response'
import { RecordedAttemptError } from './attempt-errors'
import { serializeSentResponseHeaders, type AttemptOutcome } from './attempt-outcome'
import { extractRequestIdFromBody } from './request-id'

/**
 * 一次尝试收尾所需的全部事实。
 *
 * 这些事实在搬运过程中被逐步确定（状态码、是否流式、上游请求 id……），收尾时一次性
 * 交给下面的判定函数。把「落库载荷的形状」集中在这里，编排代码就只剩流程。
 */
export interface AttemptConclusionInput {
  /** 尝试级日志器：唯一知道「真正发往上游的请求」的写入点。 */
  readonly attemptLogger: AttemptLogger
  /** 上游视角观察者：上游返回了什么从它取。 */
  readonly observer: AttemptObserver
  /** 客户端出口：客户端真正收到了什么由它决定。 */
  readonly sink: HttpResponseSink
  /** 客户端响应对象：响应头是否已经发出，只有它知道。 */
  readonly response: ProxyResponse
  readonly statusCode: number
  readonly disposition: UpstreamStatusDisposition
  /** 上游是否以流式（SSE）返回。 */
  readonly upstreamStreaming: boolean
  readonly upstreamRequestId: string | null
  readonly durationMilliseconds: number
  /** 真正发往上游的协议；只有发生了协议转换时非空。 */
  readonly upstreamProtocol: Protocol | null
  /** 本次尝试在响应阶段命中的改写规则 id。 */
  readonly responseRewriteRuleIds: string[]
}

/** 中断收尾：上游已经发过响应头，搬运中途断了。 */
export interface InterruptedAttemptInput extends AttemptConclusionInput {
  readonly failure: Error
  /** 本次尝试是否已经向客户端交付了内容；为假表示它已被放弃、一个字节都没给客户端。 */
  readonly deliverable: boolean
}

function upstreamContent(captureStatus: 'captured' | 'partial', statusCode: number, observer: AttemptObserver, body: string | null): UpstreamContentInput {
  return {
    captureStatus,
    responseStatus: statusCode,
    responseHeaders: observer.head()?.headers ?? null,
    responseBody: body,
  }
}

/**
 * 中断收尾。
 *
 * 「已经交付」与「已经放弃」的差别只有一个事实：客户端有没有收到内容。因此两条分支
 * 的 `servesRequest`、用量与客户端视角快照必须跟着这个事实走，不能靠状态码猜。
 */
export async function concludeInterruptedAttempt(input: InterruptedAttemptInput): Promise<never> {
  const partialBody = input.observer.upstreamBody()
  if (!input.deliverable) {
    await input.attemptLogger.finalizeAttempt({
      status: 'failed',
      httpStatus: input.statusCode,
      retryable: true,
      streaming: input.upstreamStreaming,
      // 本次尝试已被放弃，客户端未收到任何响应，因此不承担请求级用量。
      servesRequest: false,
      errorCode: 'UPSTREAM_STREAM_ERROR',
      errorMessage: input.failure.message,
      upstreamRequestId: input.upstreamRequestId,
      upstreamContent: upstreamContent('partial', input.statusCode, input.observer, partialBody),
    })
    throw new RecordedAttemptError(input.failure, {
      disposition: 'failover',
      statusCode: input.statusCode,
      durationMilliseconds: input.durationMilliseconds,
      upstreamRequestId: input.upstreamRequestId,
      upstreamResponseBody: partialBody,
    })
  }
  await input.attemptLogger.finalizeAttempt({
    status: 'failed',
    httpStatus: input.statusCode,
    retryable: false,
    streaming: input.upstreamStreaming,
    // 响应已经开始写出客户端，部分内容已经到达，因此它仍然是服务这个请求的尝试。
    servesRequest: true,
    errorCode: 'UPSTREAM_STREAM_ERROR',
    errorMessage: input.failure.message,
    upstreamRequestId: input.upstreamRequestId,
    usage: input.observer.usage(),
    upstreamContent: upstreamContent('partial', input.statusCode, input.observer, partialBody),
    responseRewriteRuleIds: input.responseRewriteRuleIds,
    ttftMilliseconds: input.observer.ttftMilliseconds(),
  })
  throw new RecordedAttemptError(input.failure, {
    disposition: input.disposition,
    statusCode: input.statusCode,
    durationMilliseconds: input.durationMilliseconds,
    upstreamRequestId: input.upstreamRequestId,
    upstreamResponseBody: partialBody,
    clientResponse: {
      captureStatus: 'partial',
      responseHeaders: serializeSentResponseHeaders(input.response),
      responseBody: input.sink.partialDownstreamBody(),
    },
  })
}

/**
 * 上游返回了「不该交付给客户端」的状态码。
 *
 * 这种尝试必须能被下一次尝试接替，因此它不承担请求级用量，也不带客户端视角快照：
 * 客户端什么都没收到。健康度判定用的是上游原文，所以结果里回传原文。
 */
export async function concludeUndeliverableAttempt(input: AttemptConclusionInput): Promise<AttemptOutcome> {
  const upstreamBody = input.observer.upstreamBody()
  const upstreamRequestId = input.upstreamRequestId ?? extractRequestIdFromBody(input.observer.rawBody())
  await input.attemptLogger.finalizeAttempt({
    status: 'failed',
    httpStatus: input.statusCode,
    retryable: true,
    streaming: input.upstreamStreaming,
    servesRequest: false,
    errorCode: `Status_${input.statusCode}`,
    errorMessage: `上游返回 ${input.statusCode}`,
    upstreamRequestId,
    upstreamContent: upstreamContent('captured', input.statusCode, input.observer, upstreamBody),
  })
  // 本次尝试已被放弃，客户端未收到任何响应，因此不携带 clientResponse。
  return {
    disposition: 'failover',
    statusCode: input.statusCode,
    durationMilliseconds: input.durationMilliseconds,
    upstreamRequestId,
    upstreamResponseBody: input.observer.rawBody(),
  }
}

/**
 * 交付收尾：上游响应已经（或正在）完整交给客户端。
 *
 * 「上游视角正文」与「健康度判定用的正文」在下发流式时并不相同：前者是分块快照，
 * 后者是原文。因此成功尝试用快照，非成功尝试用原文——健康度需要看到完整错误信息。
 */
export async function concludeDeliveredAttempt(input: AttemptConclusionInput): Promise<AttemptOutcome> {
  const successful = input.disposition === 'success'
  const upstreamBody = input.observer.upstreamBody()
  const resolvedBody = successful ? upstreamBody : input.observer.rawBody()
  const upstreamRequestId = input.upstreamRequestId ?? extractRequestIdFromBody(resolvedBody)
  const ttftMilliseconds = input.observer.ttftMilliseconds()
  await input.attemptLogger.finalizeAttempt({
    status: successful ? 'success' : 'failed',
    httpStatus: input.statusCode,
    retryable: false,
    streaming: input.upstreamStreaming,
    // 响应已经写出客户端，因此它就是服务这个请求的那次尝试。
    servesRequest: true,
    errorCode: successful ? undefined : `Status_${input.statusCode}`,
    errorMessage: successful ? undefined : `上游返回 ${input.statusCode}`,
    upstreamRequestId,
    usage: input.observer.usage(),
    upstreamContent: upstreamContent('captured', input.statusCode, input.observer, upstreamBody),
    responseRewriteRuleIds: input.responseRewriteRuleIds,
    ttftMilliseconds,
  })
  return {
    disposition: input.disposition,
    statusCode: input.statusCode,
    durationMilliseconds: input.durationMilliseconds,
    upstreamRequestId,
    ttftMilliseconds: ttftMilliseconds ?? undefined,
    upstreamProtocol: input.upstreamProtocol,
    upstreamResponseBody: resolvedBody,
    clientResponse: {
      captureStatus: 'captured',
      responseHeaders: serializeSentResponseHeaders(input.response),
      responseBody: input.sink.downstreamBody(),
    },
  }
}
