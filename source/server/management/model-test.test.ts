import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { TEST_DATABASE_FILE_NAME } from '../database/test-support'
import { buildTestBody, modelTestRoutes, readUsage } from './routes/diagnostics/model-test'
import { mockResponse } from './test-support'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-model-test-'))
  await initDatabase(temporaryDirectory, TEST_DATABASE_FILE_NAME)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

function responsePayload(response: ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0][0])) as Record<string, unknown>
}

function mockRequest(): IncomingMessage {
  return { once: vi.fn(), removeListener: vi.fn() } as unknown as IncomingMessage
}

describe('model test management route', () => {
  it('returns no results when no model can serve the requested protocol', async () => {
    const response = mockResponse()
    const request = mockRequest()

    await modelTestRoutes.invoke('/api/model-test/run', response, { protocol: 'openai-completions' }, request)

    expect(responsePayload(response)).toEqual({ success: true, data: { results: [] } })
  })

  it('rejects an invalid protocol before querying models', async () => {
    const response = mockResponse()
    const request = mockRequest()

    await expect(modelTestRoutes.invoke('/api/model-test/run', response, { protocol: 'unknown' }, request)).rejects.toThrow()
    expect(response.end).not.toHaveBeenCalled()
  })
})

describe('model test payload', () => {
  it('只给直连 anthropic 补 max_tokens，且压在最小值上', () => {
    expect(JSON.parse(buildTestBody('anthropic-messages', 'claude', false))).toEqual({
      model: 'claude',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Hi' }],
    })
  })

  it('走协议转换的 anthropic 不带 max_tokens（目标多是 OpenAI 形态）', () => {
    expect(JSON.parse(buildTestBody('anthropic-messages', 'gpt', true))).toEqual({
      model: 'gpt',
      messages: [{ role: 'user', content: 'Hi' }],
    })
  })

  it('两个 OpenAI 协议都不带输出上限，避免命中不支持 max_tokens 的模型', () => {
    expect(JSON.parse(buildTestBody('openai-completions', 'gpt', false))).toEqual({
      model: 'gpt',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    expect(JSON.parse(buildTestBody('openai-responses', 'gpt', false))).toEqual({
      model: 'gpt',
      input: [{ role: 'user', content: 'Hi' }],
    })
  })
})

describe('model test usage parsing', () => {
  it('认得 OpenAI、Responses 与 Anthropic 三套字段名', () => {
    expect(readUsage('{"usage":{"prompt_tokens":12,"completion_tokens":7}}')).toEqual({ inputTokens: 12, outputTokens: 7 })
    expect(readUsage('{"usage":{"input_tokens":12,"output_tokens":7}}')).toEqual({ inputTokens: 12, outputTokens: 7 })
  })

  it('读不到用量时返回 null，界面才好用 — 占位', () => {
    expect(readUsage('{"choices":[]}')).toEqual({ inputTokens: null, outputTokens: null })
    expect(readUsage('not json')).toEqual({ inputTokens: null, outputTokens: null })
    expect(readUsage('{"usage":{"prompt_tokens":"12"}}')).toEqual({ inputTokens: null, outputTokens: null })
  })
})
