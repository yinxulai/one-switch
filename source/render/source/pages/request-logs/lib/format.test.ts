import { describe, expect, it } from 'vitest'
import type { RequestLogEntryAttempt } from '@common/schemas'
import {
  distinctAttemptErrorCode,
  distinctAttemptErrorMessage,
  formatAttemptOutcome,
  formatTTFT,
  formatTPS,
} from './format'

function attemptOf(overrides: Partial<RequestLogEntryAttempt>): RequestLogEntryAttempt {
  return {
    id: 'att_1',
    attemptIndex: 0,
    status: 'success',
    providerId: 'prov_1',
    providerName: 'Provider One',
    providerModelId: 'model_1',
    providerModelName: 'model-one',
    upstreamProtocol: 'openai-completions',
    upstreamRequestId: null,
    url: 'https://example.com/v1/chat/completions',
    httpStatus: 200,
    retryable: false,
    streaming: true,
    ttftMilliseconds: null,
    requestRewriteRuleIds: [],
    responseRewriteRuleIds: [],
    errorCode: null,
    errorMessage: null,
    durationMilliseconds: 100,
    createdTime: 0,
    ...overrides,
  }
}

describe('request log metrics formatting', () => {
  it('formats TTFT in seconds with two decimal places', () => {
    expect(formatTTFT(0)).toBe('0.00s')
    expect(formatTTFT(1250)).toBe('1.25s')
    expect(formatTTFT(null)).toBe('—')
  })

  it('calculates TPS from output tokens and total duration', () => {
    expect(formatTPS(120, 5_000)).toBe('24')
    expect(formatTPS(10, 3_000)).toBe('3.3')
    expect(formatTPS(null, 3_000)).toBe('—')
  })
})

describe('attempt outcome de-duplication', () => {
  it('reports the HTTP status as the outcome, and only says so once', () => {
    expect(formatAttemptOutcome(attemptOf({ httpStatus: 401 }))).toBe('HTTP 401')
    expect(formatAttemptOutcome(attemptOf({ httpStatus: 200 }))).toBe('HTTP 200')
    // 上游一个字节都没回时没有状态码可报，这才需要另找一句话。
    expect(formatAttemptOutcome(attemptOf({ httpStatus: null, errorCode: 'UPSTREAM_TIMEOUT' }))).toBe('未收到响应')
  })

  it('drops error codes that merely mirror the HTTP status', () => {
    expect(distinctAttemptErrorCode(attemptOf({ httpStatus: 401, errorCode: 'Status_401' }))).toBeNull()
    expect(distinctAttemptErrorCode(attemptOf({ httpStatus: 504, errorCode: 'UPSTREAM_TIMEOUT' }))).toBe('UPSTREAM_TIMEOUT')
    expect(distinctAttemptErrorCode(attemptOf({ httpStatus: null, errorCode: 'UPSTREAM_TIMEOUT' }))).toBe('UPSTREAM_TIMEOUT')
    expect(distinctAttemptErrorCode(attemptOf({ errorCode: null }))).toBeNull()
  })

  it('drops error messages that merely restate the HTTP status', () => {
    expect(distinctAttemptErrorMessage(attemptOf({ httpStatus: 401, errorMessage: '上游返回 401' }))).toBeNull()
    expect(distinctAttemptErrorMessage(attemptOf({ httpStatus: 401, errorMessage: '上游返回 401 ' }))).toBeNull()
    expect(distinctAttemptErrorMessage(attemptOf({ httpStatus: 401, errorMessage: 'invalid api key' }))).toBe('invalid api key')
    // 没有状态码时同一句话反而带着「上游没回」之外的信息，不该被丢掉。
    expect(distinctAttemptErrorMessage(attemptOf({ httpStatus: null, errorMessage: '上游返回 401' }))).toBe('上游返回 401')
    expect(distinctAttemptErrorMessage(attemptOf({ errorMessage: null }))).toBeNull()
  })
})
