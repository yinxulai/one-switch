import { describe, expect, it } from 'vitest'
import type { RequestLogEntryAttempt } from '@common/schemas'
import { createAppTranslator } from '@common/i18n/catalogs'
import {
  distinctAttemptErrorCode,
  distinctAttemptErrorMessage,
  formatAttemptOutcome,
  formatTTFT,
  formatTPS,
} from './format'

const t = createAppTranslator('en')

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
    upstreamTransport: 'http-stream',
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
    expect(formatAttemptOutcome(t, attemptOf({ httpStatus: 401 }))).toBe('HTTP 401')
    expect(formatAttemptOutcome(t, attemptOf({ httpStatus: 200 }))).toBe('HTTP 200')
    // 上游一个字节都没回时没有状态码可报，这才需要另找一句话。
    expect(formatAttemptOutcome(t, attemptOf({ httpStatus: null, errorCode: 'UPSTREAM_TIMEOUT' }))).toBe('No response received')
  })

  it('drops error codes that merely mirror the HTTP status', () => {
    expect(distinctAttemptErrorCode(attemptOf({ httpStatus: 401, errorCode: 'Status_401' }))).toBeNull()
    expect(distinctAttemptErrorCode(attemptOf({ httpStatus: 504, errorCode: 'UPSTREAM_TIMEOUT' }))).toBe('UPSTREAM_TIMEOUT')
    expect(distinctAttemptErrorCode(attemptOf({ httpStatus: null, errorCode: 'UPSTREAM_TIMEOUT' }))).toBe('UPSTREAM_TIMEOUT')
    expect(distinctAttemptErrorCode(attemptOf({ errorCode: null }))).toBeNull()
  })

  it('drops error messages that merely restate the HTTP status', () => {
    // 上游非 2xx 时落库的错误信息只是状态码的副本，判据取错误码而不是文案本身。
    expect(distinctAttemptErrorMessage(attemptOf({ httpStatus: 401, errorCode: 'Status_401', errorMessage: 'Upstream responded with 401' }))).toBeNull()
    expect(distinctAttemptErrorMessage(attemptOf({ httpStatus: 401, errorMessage: 'invalid api key' }))).toBe('invalid api key')
    expect(distinctAttemptErrorMessage(attemptOf({ httpStatus: null, errorCode: 'UPSTREAM_TIMEOUT', errorMessage: 'socket hang up' }))).toBe('socket hang up')
    expect(distinctAttemptErrorMessage(attemptOf({ errorMessage: null }))).toBeNull()
  })
})
