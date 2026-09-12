import { describe, expect, it } from 'vitest'
import type { DeliveryMode, Frame } from '@server/proxy/contracts'
import { BufferedProxyResponse } from '@server/proxy/response/proxy-response'
import { createHttpResponseSink, isEventStreamResponse, isStreamingDelivery, serializeStreamingChunks } from './http-response-sink'

const JSON_HEAD: Frame = { kind: 'head', status: 200, headers: { 'content-type': 'application/json' } }
const SSE_HEAD: Frame = { kind: 'head', status: 200, headers: { 'content-type': 'text/event-stream' } }

function data(text: string): Frame {
  return { kind: 'data', body: Buffer.from(text) }
}

const END: Frame = { kind: 'end' }

function setup(delivery: DeliveryMode, captureEnabled = true) {
  const response = new BufferedProxyResponse()
  const sink = createHttpResponseSink({ response, delivery, captureEnabled })
  return { response, sink }
}

describe('streaming delivery decision', () => {
  it('only streams when the client asked for it and the upstream answered with SSE', () => {
    expect(isStreamingDelivery('stream', SSE_HEAD.headers)).toBe(true)
    expect(isStreamingDelivery('buffered', SSE_HEAD.headers)).toBe(false)
    expect(isStreamingDelivery('stream', JSON_HEAD.headers)).toBe(false)
  })

  it('detects SSE from the content type regardless of parameter case', () => {
    expect(isEventStreamResponse({ 'content-type': 'text/event-stream; charset=utf-8' })).toBe(true)
    expect(isEventStreamResponse({ 'content-type': 'application/json' })).toBe(false)
    expect(isEventStreamResponse({})).toBe(false)
  })
})

describe('http response sink', () => {
  it('buffers the whole body and writes it once the stream ends', () => {
    const { response, sink } = setup('buffered')
    sink.write(JSON_HEAD)
    sink.write(data('{"ok":'))
    // 缓冲分支下正文在头帧之后就到齐了，但一个字节都不能提前写出，否则头就落后于正文了。
    expect(response.headersSent).toBe(false)
    sink.write(data('true}'))
    sink.write(END)
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('{"ok":true}')
    expect(response.writableEnded).toBe(true)
    expect(sink.downstreamBody()).toBe('{"ok":true}')
    expect(sink.closed).toBe(true)
  })

  it('starts the response on the head frame and forwards every chunk when streaming', () => {
    const { response, sink } = setup('stream')
    sink.write(SSE_HEAD)
    expect(response.headersSent).toBe(true)
    sink.write(data('data: one\n\n'))
    // 流式分支必须边收边发，首字节不能等整段结束。
    expect(response.body).toBe('data: one\n\n')
    sink.write(data('data: two\n\n'))
    sink.write(END)
    expect(response.writableEnded).toBe(true)
    expect(sink.downstreamBody()).toBe(serializeStreamingChunks(['data: one\n\n', 'data: two\n\n']))
  })

  it('does not write to the response after it has already ended', () => {
    const { response, sink } = setup('stream')
    sink.write(SSE_HEAD)
    sink.write(data('first'))
    response.end()
    sink.write(data('second'))
    sink.write(END)
    expect(response.body).toBe('first')
    expect(sink.downstreamBody()).toBe(serializeStreamingChunks(['first']))
  })

  it('delivers nothing at all once the attempt is discarded', () => {
    const { response, sink } = setup('buffered')
    sink.write(JSON_HEAD)
    sink.discard()
    sink.write(data('{"ok":true}'))
    sink.write(END)
    expect(response.writableEnded).toBe(false)
    expect(sink.downstreamBody()).toBeNull()
    expect(sink.failure()).toBeNull()
  })

  it('keeps the buffered body even when capture is disabled but drops the chunk snapshots', () => {
    const buffered = setup('buffered', false)
    buffered.sink.write(JSON_HEAD)
    buffered.sink.write(data('{"ok":true}'))
    buffered.sink.write(END)
    expect(buffered.sink.downstreamBody()).toBe('{"ok":true}')

    const streaming = setup('stream', false)
    streaming.sink.write(SSE_HEAD)
    streaming.sink.write(data('data: one\n\n'))
    streaming.sink.write(END)
    expect(streaming.response.body).toBe('data: one\n\n')
    expect(streaming.sink.downstreamBody()).toBe(serializeStreamingChunks([]))
  })

  it('reports the failure frame without touching the response', () => {
    const { response, sink } = setup('buffered')
    const failure = new Error('upstream went away')
    sink.write(SSE_HEAD)
    sink.write({ kind: 'error', error: failure })
    expect(sink.failure()).toBe(failure)
    expect(sink.closed).toBe(true)
    // 交付中途失败不在这里收尾：销毁还是 failover 由执行器决定。
    expect(response.writableEnded).toBe(false)
  })

  it('reports the partial downstream body only for what was actually written', () => {
    const { sink } = setup('stream')
    expect(sink.partialDownstreamBody()).toBeNull()
    sink.write(SSE_HEAD)
    sink.write(data('data: one\n\n'))
    expect(sink.partialDownstreamBody()).toBe('data: one\n\n')
  })
})
