import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'
import type { RequestAttempt, RequestLog, RequestLogEntry } from '@common/schemas'
import { countRequestLogs, getRequestLog, listAttemptContents, listAttemptsByRequest, listAttemptsByRequests, listRequestContents, listRequestLogs, pruneRequestContentsBefore, pruneRequestLogsBefore } from '@server/database/request-log-store'
import { listRequestRewriteRulesByIds } from '@server/database/request-rewrite-rule-store'
import { HttpRouter } from '@server/http-router'

export const requestLogRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/request-log/list', handleListRequestLogs)
  .post('/api/request-log/detail', handleRequestLogDetail)
  .post('/api/request-log/prune', handlePruneRequestLogs)

const ListRequestLogsSchema = z.object({
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
  providerId: z.string().optional(),
  providerModelId: z.string().optional(),
  logicalModelId: z.string().optional(),
  clientProtocol: z.string().optional(),
  status: z.enum(['pending', 'success', 'failed', 'cancelled']).optional(),
  createdTimeFrom: z.number().int().nonnegative().optional(),
  createdTimeTo: z.number().int().nonnegative().optional(),
})

/**
 * 手动清理历史日志。两个保留期互相独立，都是「小于 1 天」即不清理这一项。
 *
 * 之所以分成两项：请求记录（身份 + 尝试 + 用量）很小，正文很大。想减肥的用户只需要
 * 盯住正文那一项；只清请求记录的选项也留着，免得想全清的人没有入口。
 */
const PruneRequestLogsSchema = z.object({
  requestLogRetentionDays: z.number().int().nonnegative().optional(),
  contentRetentionDays: z.number().int().nonnegative().optional(),
})
const RequestLogDetailSchema = z.object({ id: z.string().trim().min(1) })

async function handleRequestLogDetail(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { id } = RequestLogDetailSchema.parse(body ?? {})
  const log = await getRequestLog(id)
  if (!log) {
    sendError(res, 'RESOURCE_NOT_FOUND', `Request log not found: ${id}`, 404, { requestId: id })
    return
  }
  const [attempts, contents, attemptContents] = await Promise.all([
    listAttemptsByRequest(id),
    listRequestContents(id),
    listAttemptContents(id),
  ])
  const entry = mapRequestLogEntry(log, attempts)
  // 改写规则归属于尝试视角：规则是按 providerModel 匹配的，命中的是某次尝试。
  const ruleIds = [...new Set(entry.attempts.flatMap(attempt => [...attempt.requestRewriteRuleIds, ...attempt.responseRewriteRuleIds]))]
  const requestRewriteRules = (await listRequestRewriteRulesByIds(ruleIds)).map(rule => ({ id: rule.id, name: rule.name }))
  sendSuccess(res, { ...entry, contents, attemptContents, requestRewriteRules })
}

async function handlePruneRequestLogs(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { requestLogRetentionDays, contentRetentionDays } = PruneRequestLogsSchema.parse(body ?? {})
  // 顺序固定：先删请求记录，再删正文。反过来的话，第二条清理扫到的是刚被第一条
  // 连坐删掉的那批正文已经不存在，结果一样，但先删父表更符合外键方向。
  const deletedLogs = await pruneRequestLogsBefore(requestLogRetentionDays ?? 0)
  const deletedContents = await pruneRequestContentsBefore(contentRetentionDays ?? 0)
  sendSuccess(res, { deletedLogs, deletedContents })
}

async function handleListRequestLogs(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { limit, offset, providerId, providerModelId, logicalModelId, clientProtocol, status, createdTimeFrom, createdTimeTo } = ListRequestLogsSchema.parse(body ?? {})
  const pageSize = limit ?? 50
  const filter = { providerId, providerModelId, logicalModelId, clientProtocol, status, createdTimeFrom, createdTimeTo }
  const [logs, total] = await Promise.all([
    listRequestLogs(pageSize, offset ?? 0, filter),
    countRequestLogs(filter),
  ])
  const attempts = await listAttemptsByRequests(logs.map(log => log.id))
  const attemptsByRequest = new Map<string, RequestAttempt[]>()
  for (const attempt of attempts) {
    const group = attemptsByRequest.get(attempt.requestId)
    if (group) group.push(attempt)
    else attemptsByRequest.set(attempt.requestId, [attempt])
  }
  const entries = logs.map(log => mapRequestLogEntry(log, attemptsByRequest.get(log.id) ?? []))

  sendSuccess(res, { logs: entries, total })
}

/**
 * 把请求行与它的尝试行拧成列表条目。
 *
 * 尝试行由调用方批量取好再传进来：逐条请求各查一次会给列表页制造 N+1 次查询。
 * 尝试的顺序（attemptIndex 升序）由取数语句保证，这里不再重排。
 */
function mapRequestLogEntry(log: RequestLog, attempts: RequestAttempt[]): RequestLogEntry {
  return {
    id: log.id,
    logicalModelId: log.logicalModelId,
    clientProtocol: log.clientProtocol,
    transport: log.transport,
    status: log.status,
    totalDurationMilliseconds: log.totalDurationMilliseconds,
    totalTokens: log.totalTokens,
    inputTokens: log.inputTokens,
    outputTokens: log.outputTokens,
    reasoningTokens: log.reasoningTokens ?? null,
    cachedInputTokens: log.cachedInputTokens,
    cacheCreationInputTokens: log.cacheCreationInputTokens,
    promptCacheHit: log.promptCacheHit,
    rawUsage: log.rawUsage,
    ttftMilliseconds: log.ttftMilliseconds,
    createdTime: log.createdTime,
    attempts: attempts.map(a => ({
      id: a.id,
      attemptIndex: a.attemptIndex,
      status: a.status,
      providerId: a.providerId,
      providerName: a.providerName,
      providerModelId: a.providerModelId,
      providerModelName: a.providerModelName,
      upstreamProtocol: a.upstreamProtocol,
      upstreamRequestId: a.upstreamRequestId,
      url: a.url,
      httpStatus: a.httpStatus,
      retryable: a.retryable,
      upstreamTransport: a.upstreamTransport,
      ttftMilliseconds: a.ttftMilliseconds,
      requestRewriteRuleIds: a.requestRewriteRuleIds,
      responseRewriteRuleIds: a.responseRewriteRuleIds,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      durationMilliseconds: a.durationMilliseconds,
      createdTime: a.createdTime,
    })),
  }
}
