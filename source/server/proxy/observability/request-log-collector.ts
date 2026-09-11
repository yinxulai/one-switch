import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http'
import type { RequestStatus } from '@common/schemas'
import { getSettings } from '@server/database/settings-store'
import {
  createRequestContent,
  createRequestLog,
  pruneRequestLogs,
  updateRequestContent,
  updateRequestLogStatus,
} from '@server/database/request-log-store'
import { serializeCapturedHeaders } from '@server/proxy/response/headers'
import { NOOP_PROXY_OBSERVATION_HOOKS } from '@server/proxy/observability/hooks'
import { isStreamingRequest } from '@server/proxy/request/request'
import type { RequestContentOutcome, RequestLogger, RequestLoggingInput } from '@server/proxy/observability/logging-types'

/**
 * 过期清理的节流间隔。
 *
 * 保留期清理是维护动作，没必要每个请求都扫一遍全表；一分钟一次已经足够及时。
 */
const PRUNE_INTERVAL_MS = 60_000
let lastPruneTime = 0

async function pruneRequestLogsThrottled(): Promise<void> {
  const time = Date.now()
  if (time - lastPruneTime < PRUNE_INTERVAL_MS) return
  lastPruneTime = time
  const settings = await getSettings()
  await pruneRequestLogs(settings.logRetentionDays)
}

export async function initializeRequestLogger(input: RequestLoggingInput): Promise<RequestLogger> {
  let requestContentId: string | null = null
  try {
    await createRequestLog({
      id: input.requestId,
      logicalModelId: input.logicalModelId,
      clientProtocol: input.clientProtocol,
      // 客户端是否要求流式是一句话就能定下的事实，而它的写入点只此一处。
      streaming: isStreamingRequest(input.requestBody),
      status: 'pending',
      totalDurationMilliseconds: 0,
      attributes: input.attributes,
    })
    if (input.captureRequestContent) {
      const content = await createRequestContent({
        requestId: input.requestId,
        captureStatus: 'partial',
        requestMethod: input.method,
        requestPath: input.path,
        requestHeaders: serializeCapturedHeaders(input.headers),
        requestBody: input.requestBody.toString('utf8'),
      })
      requestContentId = content.id
    }
  } catch (error) {
    console.error(`[proxy] 写入请求日志失败: ${(error as Error).message}`)
  }

  return createRequestLogger(requestContentId, input)
}

function createRequestLogger(requestContentId: string | null, input: RequestLoggingInput): RequestLogger {
  const hooks = input.hooks ?? NOOP_PROXY_OBSERVATION_HOOKS
  /** 已经收尾过：取消竞态下两条路径会先后调用同一个 logger。 */
  let finalized = false

  const finalizeRequestLog = async (status: RequestStatus, startedAt: number) => {
    // 后到的收尾是重复的事实，不是新的事实：不重写状态，也不重复触发清理。
    if (finalized) return
    finalized = true
    try {
      await updateRequestLogStatus(input.requestId, {
        status,
        totalDurationMilliseconds: Date.now() - startedAt,
      })
      await pruneRequestLogsThrottled()
    } catch (error) {
      console.error(`[proxy] 更新请求日志失败: ${(error as Error).message}`)
    }
  }

  /**
   * 写入客户端视角的最终响应。列名不带 `client` 前缀——表本身就代表客户端视角。
   */
  const finalizeRequestContent = async (outcome: RequestContentOutcome) => {
    if (!requestContentId) return
    try {
      await updateRequestContent(requestContentId, {
        captureStatus: outcome.captureStatus ?? 'captured',
        responseStatus: outcome.statusCode,
        responseHeaders: outcome.responseHeaders ?? null,
        responseBody: outcome.responseBody ?? null,
      })
      await hooks.onContentCaptured?.({ requestId: input.requestId, perspective: 'client' })
    } catch (error) {
      console.error(`[proxy] 更新请求正文失败: ${(error as Error).message}`)
    }
  }

  const finalizeLocalErrorContent = async (statusCode: number, responseHeaders: IncomingHttpHeaders | OutgoingHttpHeaders, responseBody: string) => {
    await finalizeRequestContent({
      perspective: 'client',
      statusCode,
      captureStatus: 'captured',
      responseHeaders: serializeCapturedHeaders(responseHeaders),
      responseBody,
    })
  }

  return {
    requestContentId,
    finalizeRequestLog,
    finalizeRequestContent,
    finalizeLocalErrorContent,
  }
}
