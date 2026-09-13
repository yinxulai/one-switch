import { describe, expect, it, vi } from 'vitest'
import type { Frame, FrameSink, HeadFrame, ModifierContext } from '@server/proxy/contracts'
import type { RequestRewriteRule } from '@common/schemas'
import type { NativeProtocolAdapter, ProtocolAdapter, ProtocolConversionAdapter } from '@server/proxy/protocols/shared/types'
import { pipeFrames } from '@server/proxy/kernel/frame-pipe'
import { selectCandidates } from '@server/proxy/kernel/modifier-selection'
import { createResponseModifiers, type AttemptRouting } from './response-modifiers'

const JSON_HEAD: HeadFrame = { kind: 'head', status: 200, headers: { 'content-type': 'application/json', 'content-length': '18' } }
const SSE_HEAD: HeadFrame = { kind: 'head', status: 200, headers: { 'content-type': 'text/event-stream' } }

/** 正常交付：上游 2xx，字节给客户端。 */
const DELIVERED: AttemptRouting = { deliverable: true, successful: true }
/**
 * 执行器已经判定的 failover：这次响应一个字节都不交付。
 *
 * 「客户端要增量、上游回了整包」就落在这一档——它是**上游违约**，不是「改成整包交付」
 * （见 `product/proxy-engine.md` §1.2）。因此这里的修改器必须原样透传，绝不能自己
 * 攒一份整包再发出去。
 */
const ABANDONED: AttemptRouting = { deliverable: false, successful: false }

function nativeAdapter(): NativeProtocolAdapter {
  return {
    kind: 'native',
    clientProtocol: 'openai-completions',
    endpointProtocol: 'openai-completions',
    requiresResponseConversion: false,
    prepareRequest: () => Buffer.alloc(0),
    createStreamConverter: () => null,
    finishStream: () => '',
    convertResponse: body => body,
  }
}

function conversionAdapter(onConvert = vi.fn()): ProtocolConversionAdapter {
  return {
    kind: 'conversion',
    clientProtocol: 'openai-completions',
    endpointProtocol: 'anthropic-messages',
    requiresResponseConversion: true,
    prepareRequest: () => Buffer.alloc(0),
    createStreamConverter: () => ({
      push(chunk) { onConvert(chunk); return `[c]${chunk}` },
      flush: () => '',
    }),
    finishStream: () => '[c]tail',
    convertResponse(body) {
      const text = body.toString('utf8')
      onConvert(text)
      return Buffer.from(`[c]${text}`)
    },
  }
}

function createContext(overrides: Partial<ModifierContext['exchange']> = {}): ModifierContext {
  return {
    direction: 'response',
    clientProtocol: 'openai-completions',
    upstreamProtocol: 'anthropic-messages',
    exchange: {
      requestId: 'req-1',
      logicalModelId: 'logical-1',
      clientProtocol: 'openai-completions',
      transport: 'http',
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      body: Buffer.alloc(0),
      signal: new AbortController().signal,
      ...overrides,
    },
    attempt: { index: 0, endpointId: 'messages', endpointProtocol: 'anthropic-messages' },
    upstreamHead: null,
  }
}

function createSink(): FrameSink & { readonly frames: Frame[] } {
  const frames: Frame[] = []
  return {
    frames,
    closed: false,
    write(frame: Frame): void { frames.push(frame) },
  }
}

async function* frameSource(frames: Frame[]): AsyncIterable<Frame> {
  for (const frame of frames) yield frame
}

function responseRule(): RequestRewriteRule {
  return {
    id: 'rule-response',
    name: '响应改写',
    description: '',
    enabled: true,
    scope: 'model',
    schemaVersion: 1,
    source: 'user',
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [{ type: 'body-set', stage: 'response', path: '$.text', value: 'rewritten' }],
    testCases: [],
    createdTime: 1,
    updatedTime: 1,
    deletedTime: null,
  }
}

function dataFrames(frames: readonly Frame[]): string[] {
  return frames.filter(frame => frame.kind === 'data').map(frame => (frame as { body: Buffer }).body.toString('utf8'))
}

type RunInput = {
  frames: Frame[]
  adapter: ProtocolAdapter
  routing: AttemptRouting
  context: ModifierContext
  rules?: readonly RequestRewriteRule[]
}

async function run(input: RunInput) {
  const sink = createSink()
  const onRewriteEvaluated = vi.fn()
  const modifiers = createResponseModifiers({
    adapter: input.adapter,
    routing: input.routing,
    rules: input.rules ?? [],
    onRewriteEvaluated,
    onConversionError: vi.fn(),
  })
  const result = await pipeFrames({ frames: frameSource(input.frames), sink, context: input.context, modifiers })
  return { frames: sink.frames, result, onRewriteEvaluated }
}

describe('protocol conversion modifier', () => {
  it('整包交付时把上游整包只转换一次', async () => {
    const body = '{"text":"original"}'
    const { frames } = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from(body) }, { kind: 'end' }],
      adapter: conversionAdapter(),
      routing: DELIVERED,
      context: createContext({ transport: 'http' }),
    })

    expect(dataFrames(frames)).toEqual([`[c]${body}`])
    expect(frames[frames.length - 1].kind).toBe('end')
  })

  it('增量传输时逐块转换上游 SSE，并在结束时补上转换器尾巴', async () => {
    const { frames } = await run({
      frames: [
        SSE_HEAD,
        { kind: 'data', body: Buffer.from('data: a\n\n') },
        { kind: 'data', body: Buffer.from('data: b\n\n') },
        { kind: 'end' },
      ],
      adapter: conversionAdapter(),
      routing: DELIVERED,
      context: createContext({ transport: 'http-stream' }),
    })

    expect(dataFrames(frames)).toEqual(['[c]data: a\n\n', '[c]data: b\n\n', '[c]tail'])
  })

  it('客户端要增量而上游回了整包时原样透传，不自己攒出一份整包', async () => {
    const onConvert = vi.fn()
    const body = '{"text":"original"}'
    const { frames } = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from(body) }, { kind: 'end' }],
      adapter: conversionAdapter(onConvert),
      routing: ABANDONED,
      context: createContext({ transport: 'http-stream' }),
    })

    // 这次尝试已被执行器判为 failover：转换器根本不该被选中，字节按上游给的样子透传。
    expect(onConvert).not.toHaveBeenCalled()
    expect(dataFrames(frames)).toEqual([body])
  })
})

describe('downstream head modifier', () => {
  it('只有增量传输能保住上游的 content-length', async () => {
    const entire = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from('{"text":"original"}') }, { kind: 'end' }],
      adapter: nativeAdapter(),
      routing: ABANDONED,
      context: createContext({ transport: 'http' }),
    })
    const incremental = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from('{"text":"original"}') }, { kind: 'end' }],
      adapter: nativeAdapter(),
      routing: ABANDONED,
      context: createContext({ transport: 'http-stream' }),
    })

    // 整包传输下正文可能被响应改写改短改长，长度不再可信；增量传输是逐帧原样透传，长度仍然可信。
    expect((entire.frames[0] as HeadFrame).headers['content-length']).toBeUndefined()
    expect((incremental.frames[0] as HeadFrame).headers['content-length']).toBe('18')
  })
})

describe('response rewrite modifier', () => {
  it('按声明的传输形态被内核排除，不需要自己去判断', () => {
    const modifiers = createResponseModifiers({
      adapter: nativeAdapter(),
      routing: DELIVERED,
      rules: [],
      onRewriteEvaluated: vi.fn(),
      onConversionError: vi.fn(),
    })

    const entire = selectCandidates(modifiers, createContext({ transport: 'http' }), 'frame').map(modifier => modifier.id)
    const incremental = selectCandidates(modifiers, createContext({ transport: 'http-stream' }), 'frame').map(modifier => modifier.id)

    expect(entire).toContain('response-rewrite')
    expect(incremental).not.toContain('response-rewrite')
    // 被排除的只有「在增量传输下没有能做的事」的那一个，其余修改器照常参与。
    expect(incremental).toEqual(expect.arrayContaining(['downstream-head', 'protocol-conversion']))
  })

  it('整包传输下改写整份 JSON 正文并更新 content-length', async () => {
    const { frames, onRewriteEvaluated } = await run({
      frames: [JSON_HEAD, { kind: 'data', body: Buffer.from('{"text":"original"}') }, { kind: 'end' }],
      adapter: nativeAdapter(),
      routing: DELIVERED,
      context: createContext({ transport: 'http' }),
      rules: [responseRule()],
    })

    const rewritten = '{"text":"rewritten"}'
    expect(dataFrames(frames)).toEqual([rewritten])
    expect((frames[0] as HeadFrame).headers['content-length']).toBe(String(rewritten.length))
    expect(onRewriteEvaluated).toHaveBeenCalledWith(expect.objectContaining({ appliedRuleIds: ['rule-response'] }))
  })

  it('增量传输下逐帧原样透传，规则一次都不执行', async () => {
    const { frames, onRewriteEvaluated } = await run({
      frames: [SSE_HEAD, { kind: 'data', body: Buffer.from('data: {"text":"original"}\n\n') }, { kind: 'end' }],
      adapter: nativeAdapter(),
      routing: DELIVERED,
      context: createContext({ transport: 'http-stream' }),
      rules: [responseRule()],
    })

    expect(dataFrames(frames)).toEqual(['data: {"text":"original"}\n\n'])
    expect(onRewriteEvaluated).not.toHaveBeenCalled()
  })

  it('不成功的响应不做改写：协议转换已经决定了它不会被交付', async () => {
    const { frames, onRewriteEvaluated } = await run({
      frames: [{ kind: 'head', status: 500, headers: { 'content-type': 'application/json' } }, { kind: 'end' }],
      adapter: nativeAdapter(),
      routing: ABANDONED,
      context: createContext({ transport: 'http' }),
      rules: [responseRule()],
    })

    expect(frames.some(frame => frame.kind === 'head' && frame.status === 500)).toBe(true)
    expect(onRewriteEvaluated).not.toHaveBeenCalled()
  })
})
