import { describe, expect, it } from 'vitest'
import type { AttemptOutcomeView, AttemptView, DeliveryMode, ExchangeView } from '@server/proxy/contracts'
import { serializeStreamingChunks } from '@server/proxy/adapters/http-response-sink'
import { createAttemptObserver } from './attempt-observer'

const JSON_HEADERS = { 'content-type': 'application/json' }
const SSE_HEADERS = { 'content-type': 'text/event-stream' }

function createExchange(delivery: DeliveryMode): ExchangeView {
  return {
    requestId: 'req-1',
    logicalModelId: 'logical-1',
    clientProtocol: 'openai-completions',
    transport: 'http',
    method: 'POST',
    path: '/v1/chat/completions',
    headers: {},
    body: Buffer.alloc(0),
    delivery,
    signal: new AbortController().signal,
  }
}

const ATTEMPT: AttemptView = { index: 0, endpointId: 'model-1:openai-completions', endpointProtocol: 'openai-completions' }
const OUTCOME: AttemptOutcomeView = { status: 200, durationMilliseconds: 5 }

function setup(delivery: DeliveryMode, captureEnabled = true, startedAt = Date.now()) {
  const exchange = createExchange(delivery)
  const observer = createAttemptObserver({ exchange, attempt: ATTEMPT, captureEnabled, startedAt })
  const send = (text: string) => observer.onUpstreamChunk?.(exchange, ATTEMPT, Buffer.from(text))
  const head = (headers: Record<string, string>, status = 200) => observer.onUpstreamHead?.(exchange, ATTEMPT, status, headers)
  const end = () => observer.onAttemptEnd?.(exchange, ATTEMPT, OUTCOME)
  return { observer, send, head, end }
}

describe('attempt observer', () => {
  it('keeps the upstream head it was told about', () => {
    const { observer, head } = setup('buffered')
    expect(observer.head()).toBeNull()
    head(JSON_HEADERS, 201)
    expect(observer.head()).toEqual({ kind: 'head', status: 201, headers: JSON_HEADERS })
  })

  it('treats the upstream body as the raw payload for non-streaming responses', () => {
    const { observer, head, send, end } = setup('buffered')
    head(JSON_HEADERS)
    send('{"usage"')
    send(':{"prompt_tokens":3}}')
    end()
    expect(observer.streaming()).toBe(false)
    expect(observer.upstreamBody()).toBe('{"usage":{"prompt_tokens":3}}')
    expect(observer.rawBody()).toBe('{"usage":{"prompt_tokens":3}}')
    expect(observer.usage()).toMatchObject({ inputTokens: 3 })
  })

  it('reports no TTFT for non-streaming responses even when they contain output', () => {
    const { observer, head, send, end } = setup('buffered')
    head(JSON_HEADERS)
    send('{"choices":[{"message":{"content":"hello"}}]}')
    end()
    // 客户端拿到的是整段正文，不存在「首字节」这回事。
    expect(observer.ttftMilliseconds()).toBeNull()
  })

  it('snapshots streaming bodies chunk by chunk while keeping the raw text', () => {
    const { observer, head, send, end } = setup('stream')
    head(SSE_HEADERS)
    send('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
    send('data: [DONE]\n')
    end()
    expect(observer.streaming()).toBe(true)
    expect(observer.upstreamBody()).toBe(serializeStreamingChunks(['data: {"choices":[{"delta":{"content":"a"}}]}\n\n', 'data: [DONE]\n']))
    expect(observer.rawBody()).toBe('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: [DONE]\n')
  })

  it('only counts real generated output as the first byte', () => {
    const { observer, head, send } = setup('stream')
    head(SSE_HEADERS)
    send('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')
    expect(observer.ttftMilliseconds()).toBeNull()
    send('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n')
    expect(observer.ttftMilliseconds()).not.toBeNull()
    expect(observer.ttftMilliseconds()).toBeGreaterThanOrEqual(0)
  })

  it('counts a trailing SSE event as the first byte when the stream ends', () => {
    const { observer, head, send, end } = setup('stream')
    head(SSE_HEADERS)
    send('data: {"choices":[{"delta":{"content":"hello"}}]}')
    end()
    expect(observer.ttftMilliseconds()).not.toBeNull()
  })

  it('does not stream when the client did not ask for it, even for an SSE upstream', () => {
    const { observer, head, send, end } = setup('buffered')
    head(SSE_HEADERS)
    send('data: {"usage":{"prompt_tokens":4}}\n\n')
    end()
    expect(observer.streaming()).toBe(false)
    // 客户端不是流式，拿到的就是原始字节，因此不可能有分块快照；也不存在首字节时延。
    expect(observer.upstreamBody()).toBe('data: {"usage":{"prompt_tokens":4}}\n\n')
    expect(observer.rawBody()).toBe('data: {"usage":{"prompt_tokens":4}}\n\n')
    expect(observer.ttftMilliseconds()).toBeNull()
  })

  it('drops the chunk snapshots but keeps the raw text when capture is disabled', () => {
    const { observer, head, send, end } = setup('stream', false)
    head(SSE_HEADERS)
    send('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
    end()
    // 健康度判定读原文，因此关掉采集也不能丢它。
    expect(observer.rawBody()).toBe('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
    expect(observer.upstreamBody()).toBe(serializeStreamingChunks([]))
  })

  it('keeps the partial upstream body when the attempt dies mid-stream', () => {
    const { observer, head, send } = setup('stream')
    head(SSE_HEADERS)
    send('data: {"choices":[{"delta":{"content":"a"}}]}\n\n')
    // 没有 end 帧：上游断在半路，已经收到的部分照样要能落库。
    expect(observer.partialUpstreamBody()).toBe(serializeStreamingChunks(['data: {"choices":[{"delta":{"content":"a"}}]}\n\n']))
  })
})
