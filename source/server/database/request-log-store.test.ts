import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from './index'
import { TEST_DATABASE_FILE_NAME } from './test-support'
import { createProvider } from './provider-store'
import {
  countRequestLogs,
  createAttemptContent,
  createRequestAttempt,
  createRequestContent,
  createRequestLog,
  getAttemptUsage,
  getRequestLog,
  getRequestUsage,
  listAttemptContents,
  listRequestContents,
  listRequestLogs,
  listAttemptsByRequest,
  pruneRequestLogsBefore,
  recordAttemptUsage,
  updateAttemptContent,
  updateRequestContent,
  updateRequestLogStatus,
} from './request-log-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-request-log-'))
  await initDatabase(temporaryDirectory, TEST_DATABASE_FILE_NAME)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

async function createLog(id: string, status: 'pending' | 'success' | 'failed' = 'success') {
  return createRequestLog({
    id,
    logicalModelId: 'model_default',
    clientProtocol: 'openai-completions',
    transport: 'http-stream',
    status,
    totalDurationMilliseconds: 10,
  })
}

/** 同一请求的同一次序号只能落一行，冲突时 store 返回 `null`。 */
async function createAttemptOrThrow(input: Parameters<typeof createRequestAttempt>[0]) {
  const attempt = await createRequestAttempt(input)
  if (!attempt) throw new Error('expected attempt to be created')
  return attempt
}

/** 用量字段的「都不知道」形状，用于只关心部分字段的用例。 */
const EMPTY_USAGE = { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null }

describe('request log store persistence', () => {
  it('filters, counts, paginates, and maps request logs from stored rows', async () => {
    const first = await createLog('req_first', 'success')
    const second = await createLog('req_second', 'failed')
    getDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(100, first.id)
    getDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(200, second.id)

    expect(await countRequestLogs({ status: 'failed', createdTimeFrom: 150, createdTimeTo: 250 })).toBe(1)
    expect(await listRequestLogs(1, 0, { logicalModelId: 'model_default' })).toEqual([
      expect.objectContaining({ id: second.id, status: 'failed', totalDurationMilliseconds: 10 }),
    ])
    expect(await listRequestLogs(1, 1)).toEqual([expect.objectContaining({ id: first.id })])
  })

  it('round-trips content, attempts, and usages and updates content fields', async () => {
    const log = await createLog('req_related')
    const provider = await createProvider({ name: 'Related Provider', apiKeyReference: 'related-key', timeoutMilliseconds: 1000 })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_related',
      providerName: provider.name,
      providerModelName: 'related-model',
      upstreamProtocol: 'openai-completions',
      upstreamRequestId: 'upstream-1',
      url: 'https://example.com/v1/chat/completions',
      attemptIndex: 0,
      status: 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http-stream',
      durationMilliseconds: 8,
      ttftMilliseconds: 3,
      requestRewriteRuleIds: ['rule_a', 'rule_b'],
      responseRewriteRuleIds: ['rule_c'],
    })
    // 这次尝试就是服务该请求的那次，因此同一事务里把用量镜像到请求级。
    await recordAttemptUsage({ attemptId: attempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 7, outputTokens: 2 })
    const content = await createRequestContent({
      requestId: log.id,
      captureStatus: 'partial',
      requestMethod: 'POST',
      requestPath: '/v1/chat/completions',
      requestHeaders: '{"x-test":"1"}',
      requestBody: '{}',
    })
    await updateRequestContent(content.id, { captureStatus: 'captured', responseStatus: 200, responseBody: '{"ok":true}' })
    const attemptContent = await createAttemptContent({
      attemptId: attempt.id,
      captureStatus: 'partial',
      requestHeaders: '{"x-upstream":"1"}',
      requestBody: '{}',
    })
    await updateAttemptContent(attemptContent.id, { captureStatus: 'captured', responseStatus: 200, responseBody: '{"ok":true}' })

    expect(await listAttemptsByRequest(log.id)).toEqual([expect.objectContaining({
      id: attempt.id,
      httpStatus: 200,
      upstreamTransport: 'http-stream',
      ttftMilliseconds: 3,
      requestRewriteRuleIds: ['rule_a', 'rule_b'],
      responseRewriteRuleIds: ['rule_c'],
    })])
    // 请求级 TTFT 由尝试级取最小值得出，不存第二份副本。
    expect((await getRequestLog(log.id))?.ttftMilliseconds).toBe(3)
    // 两个视角的用量各自存在自己的表里，互不影面。
    expect(await getAttemptUsage(attempt.id)).toEqual({ inputTokens: 7, outputTokens: 2, totalTokens: 9, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null })
    expect(await getRequestUsage(log.id)).toEqual({ inputTokens: 7, outputTokens: 2, totalTokens: 9, cachedInputTokens: null, cacheCreationInputTokens: null, reasoningTokens: null, rawUsage: null })
    expect(await listRequestContents(log.id)).toEqual([expect.objectContaining({
      id: content.id,
      captureStatus: 'captured',
      responseStatus: 200,
      responseBody: '{"ok":true}',
    })])
    expect(await listAttemptContents(log.id)).toEqual([expect.objectContaining({
      id: attemptContent.id,
      attemptId: attempt.id,
      captureStatus: 'captured',
      responseStatus: 200,
      responseBody: '{"ok":true}',
    })])
  })

  it('updates request outcome fields and prunes all related rows', async () => {
    const log = await createLog('req_prunable', 'pending')
    await updateRequestLogStatus(log.id, { status: 'success', totalDurationMilliseconds: 20 })
    await updateRequestLogStatus(log.id, { totalDurationMilliseconds: 0 })
    expect(await getRequestLog(log.id)).toMatchObject({
      status: 'success',
      totalDurationMilliseconds: 0,
      // 没有任何尝试时，请求级用量与 TTFT 只能是「还不知道」。
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      rawUsage: null,
      ttftMilliseconds: null,
      promptCacheHit: null,
    })

    await createRequestContent({
      requestId: log.id,
      captureStatus: 'captured',
      requestMethod: 'GET',
      requestPath: '/',
      requestHeaders: null,
      requestBody: null,
      responseStatus: 200,
      responseHeaders: null,
      responseBody: null,
    })
    // 外键要求 attempt_contents 指向真实尝试记录。
    const pruneProvider = await createProvider({ name: 'Prune Provider', apiKeyReference: 'prune-key', timeoutMilliseconds: 1000 })
    const pruneAttempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: pruneProvider.id,
      providerModelId: 'model_prune',
      providerName: pruneProvider.name,
      providerModelName: 'prune-model',
      upstreamProtocol: 'openai-completions',
      upstreamRequestId: null,
      url: 'https://example.com/v1/chat/completions',
      attemptIndex: 0,
      status: 'success',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      durationMilliseconds: 3,
    })
    await createAttemptContent({
      attemptId: pruneAttempt.id,
      captureStatus: 'captured',
      requestHeaders: null,
      requestBody: null,
      responseStatus: 200,
      responseHeaders: null,
      responseBody: null,
    })
    await recordAttemptUsage({ attemptId: pruneAttempt.id, servesRequest: true, ...EMPTY_USAGE, inputTokens: 1, outputTokens: 1 })
    getDb().$client.prepare('UPDATE request_logs SET createdTime = ? WHERE id = ?').run(Date.now() - 3 * 24 * 60 * 60 * 1000, log.id)

    expect(await pruneRequestLogsBefore(1)).toBe(1)
    expect(await getRequestLog(log.id)).toBeNull()
    expect(await getDb().$client.prepare('SELECT COUNT(*) AS count FROM request_contents WHERE requestId = ?').get(log.id)).toEqual({ count: 0 })
    expect(await getDb().$client.prepare('SELECT COUNT(*) AS count FROM attempt_contents WHERE attemptId = ?').get(pruneAttempt.id)).toEqual({ count: 0 })
    expect(await getDb().$client.prepare('SELECT COUNT(*) AS count FROM attempt_usages WHERE attemptId = ?').get(pruneAttempt.id)).toEqual({ count: 0 })
    expect(await getDb().$client.prepare('SELECT COUNT(*) AS count FROM request_usages WHERE requestId = ?').get(log.id)).toEqual({ count: 0 })
  })
})
