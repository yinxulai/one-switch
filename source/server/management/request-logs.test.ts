import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { TEST_DATABASE_FILE_NAME } from '../database/test-support'
import { createProvider } from '@server/database/provider-store'
import { createAttemptContent, createRequestAttempt, createRequestContent, createRequestLog } from '@server/database/request-log-store'
import { createRequestRewriteRule, deleteRequestRewriteRule } from '@server/database/request-rewrite-rule-store'
import { requestLogRoutes } from './routes/observability/request-logs'
import { mockResponse } from './test-support'

function responseData(res: ServerResponse): unknown {
  const body = vi.mocked(res.end).mock.calls[0]?.[0]
  return JSON.parse(String(body))
}

/** 同一请求的同一次序号只能落一行，冲突时 store 返回 `null`。 */
async function createAttemptOrThrow(input: Parameters<typeof createRequestAttempt>[0]) {
  const attempt = await createRequestAttempt(input)
  if (!attempt) throw new Error('expected attempt to be created')
  return attempt
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-request-log-'))
  await initDatabase(temporaryDirectory, TEST_DATABASE_FILE_NAME)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('request log management', () => {
  it('filters request logs by provider model id', async () => {
    const provider = await createProvider({ name: 'Provider', apiKeyReference: 'key_filter', timeoutMilliseconds: 30_000, enabled: true })
    const matched = await createRequestLog({
      id: 'req_model_match',
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 10,
    })
    const other = await createRequestLog({
      id: 'req_model_other',
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'success',
      totalDurationMilliseconds: 10,
    })

    await createAttemptOrThrow({
      requestId: matched.id,
      providerId: provider.id,
      providerModelId: 'model_match',
      providerName: provider.name,
      providerModelName: 'match-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/match',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 10,
    })
    await createAttemptOrThrow({
      requestId: other.id,
      providerId: provider.id,
      providerModelId: 'model_other',
      providerName: provider.name,
      providerModelName: 'other-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/other',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 10,
    })

    const res = mockResponse()
    await requestLogRoutes.invoke('/api/request-log/list', res, { providerModelId: 'model_match' })

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        total: 1,
        logs: [expect.objectContaining({ id: matched.id })],
      }),
    }))
  })

  it('returns one log with attempts and request contents on demand', async () => {
    const provider = await createProvider({ name: 'Provider', apiKeyReference: 'key_detail', timeoutMilliseconds: 30_000, enabled: true })
    const log = await createRequestLog({
      id: 'req_detail',
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      transport: 'http-stream',
      status: 'success',
      totalDurationMilliseconds: 10,
    })
    const attempt = await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_detail',
      providerName: provider.name,
      providerModelName: 'detail-model',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http-stream',
      ttftMilliseconds: 42,
      attemptIndex: 0,
      status: 'success',
      durationMilliseconds: 10,
    })
    const rule = await createRequestRewriteRule({
      name: '请求日志规则名称',
      description: '',
      enabled: true,
      scope: 'global',
      schemaVersion: 1,
      source: 'user',
      match: { clientProtocols: [], upstreamProtocols: [] },
      actions: [{ type: 'header-set', stage: 'request', name: 'x-test', value: 'true' }],
      testCases: [],
    })
    // 规则命中是尝试自身的事实，与是否采集正文无关，因此写在 request_attempts 上。
    await createAttemptOrThrow({
      requestId: log.id,
      providerId: provider.id,
      providerModelId: 'model_detail_second',
      providerName: provider.name,
      providerModelName: 'detail-model-second',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http',
      attemptIndex: 1,
      status: 'success',
      durationMilliseconds: 6,
      requestRewriteRuleIds: [rule.id, 'rule_missing'],
      responseRewriteRuleIds: ['rule_response'],
    })
    await createRequestContent({
      requestId: log.id,
      captureStatus: 'captured',
      requestMethod: 'POST',
      requestPath: '/v1/responses',
      requestHeaders: '{"authorization":"[REDACTED]"}',
      requestBody: '{"model":"detail-model"}',
      responseStatus: 200,
      responseHeaders: '{"content-type":"application/json","x-client":"1"}',
      responseBody: '{"ok":true}',
    })
    await createAttemptContent({
      attemptId: attempt.id,
      captureStatus: 'captured',
      requestHeaders: '{"x-upstream":"1"}',
      requestBody: '{"model":"detail-model"}',
      responseStatus: 200,
      responseHeaders: '{"content-type":"application/json"}',
      responseBody: '{"ok":true}',
    })
    await deleteRequestRewriteRule(rule.id)
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/detail', res, { id: log.id })

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual({
      success: true,
      data: expect.objectContaining({
        id: log.id,
        attempts: [
          expect.objectContaining({ id: attempt.id, providerModelName: 'detail-model', upstreamTransport: 'http-stream', ttftMilliseconds: 42 }),
          expect.objectContaining({ upstreamTransport: 'http', requestRewriteRuleIds: [rule.id, 'rule_missing'], responseRewriteRuleIds: ['rule_response'] }),
        ],
        contents: [expect.objectContaining({ captureStatus: 'captured', responseHeaders: '{"content-type":"application/json","x-client":"1"}' })],
        attemptContents: [expect.objectContaining({ attemptId: attempt.id, responseBody: '{"ok":true}' })],
        requestRewriteRules: [{ id: rule.id, name: '请求日志规则名称' }],
      }),
    })
  })

  it('returns not found for a missing request log', async () => {
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/detail', res, { id: 'req_missing' })

    expect(res.statusCode).toBe(404)
    expect(responseData(res)).toEqual({
      success: false,
      errorCode: 'RESOURCE_NOT_FOUND',
      errorMessage: 'Request log not found: req_missing',
      errorParams: { requestId: 'req_missing' },
    })
  })

  it('returns details for a diagnostic request log id', async () => {
    const log = await createRequestLog({
      id: 'diagnostic_detail',
      logicalModelId: 'diagnostic',
      clientProtocol: 'openai-responses',
      transport: 'http',
      status: 'failed',
      totalDurationMilliseconds: 10,
    })
    const res = mockResponse()

    await requestLogRoutes.invoke('/api/request-log/detail', res, { id: log.id })

    expect(res.statusCode).toBe(200)
    expect(responseData(res)).toEqual({
      success: true,
      data: expect.objectContaining({ id: 'diagnostic_detail' }),
    })
  })
})
