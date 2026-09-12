import { describe, expect, it, vi } from 'vitest'
import type { AttemptView, ExchangeView, Frame, FrameSink, Modifier, Observer, Transport, UpstreamConnection, UpstreamTarget } from '@server/proxy/contracts'
import { relayAttempt, relayConnected } from './relay'

/**
 * 这个文件是内核**双向搬运**唯一的练习者。
 *
 * WS 传输已经从这个仓库里拿掉了（见 `product/websocket-transport.md`），因此 `relayConnected`
 * 目前没有任何调用方。它被留下来是因为它是「一种连接带写入侧」这条扩展缝的实现——不含任何
 * WebSocket 细节，却承担着三条容易写错的收尾不变式：任何一侧结束就对端一起结束、下游不要了
 * 就必须断开没走完的上游、上游只断一次。删掉它，将来加双向传输时这些不变式就得重新推一遍。
 *
 * 测试用的假传输刻意用**最朴素**的形式：一个帧数组 + 一道闸门。闸门代表「对端还在，但暂时没有
 * 新帧」，`abort` / `close` 会放闸——真实传输里这正是断开连接的效果。
 */

function createExchange(): ExchangeView {
  return {
    requestId: 'req-1',
    logicalModelId: 'logical-1',
    clientProtocol: 'openai-responses',
    // 内核不关心载体是谁，只关心连接有没有写入侧，因此这里用的取值不影响被测行为。
    transport: 'http',
    method: 'POST',
    path: '/v1/responses',
    headers: {},
    body: Buffer.alloc(0),
    delivery: 'buffered',
    signal: new AbortController().signal,
  }
}

/**
 * 只收集帧的出口。
 *
 * `closeAfterWrites` 让出口在收到第 n 帧之后自己关闭，用来模拟「下游读到一半就不要了」——
 * 真实的提前停止消费（客户端取消、failover 提前放弃）都长这样。
 */
function createSink(closeAfterWrites: number | null = null): FrameSink & { readonly frames: Frame[] } {
  const frames: Frame[] = []
  let closed = false
  return {
    frames,
    get closed(): boolean { return closed },
    write(frame: Frame): void {
      frames.push(frame)
      if (closeAfterWrites !== null && frames.length >= closeAfterWrites) closed = true
    },
  }
}

function createTarget(): UpstreamTarget {
  return {
    providerId: 'prov_alpha',
    providerName: 'alpha',
    providerModelId: 'model_alpha',
    providerModelName: 'alpha-upstream',
    apiKeyReference: 'prov_alpha_key',
    customAuthHeader: null,
    endpointId: 'model_alpha:openai-responses',
    protocol: 'openai-responses',
    url: 'https://upstream.example.com/v1/responses',
    transport: 'http',
    timeoutMilliseconds: 1_000,
  }
}

const ATTEMPT: AttemptView = { index: 0, endpointId: 'model_alpha:openai-responses', endpointProtocol: 'openai-responses' }
const HEAD: Frame = { kind: 'head', status: 200, headers: { 'content-type': 'text/event-stream' } }
const END: Frame = { kind: 'end' }

/** 一道闸门：代表「对端还在，但暂时没有新帧」。放闸后帧序列正常结束（`end` 帧的等价物）。 */
function createGate(): { readonly wait: Promise<void>, open(): void } {
  let open = (): void => {}
  const wait = new Promise<void>(resolve => { open = resolve })
  return { wait, open }
}

interface UpstreamFixture {
  readonly connection: UpstreamConnection
  /** 上游被主动断开的次数。不变式是「最多一次」。 */
  abortedCount(): number
}

interface UpstreamOptions {
  readonly frames: readonly Frame[]
  readonly outbound?: FrameSink
}

function createUpstream(options: UpstreamOptions): UpstreamFixture {
  const gate = createGate()
  let aborted = 0
  async function* source(): AsyncIterable<Frame> {
    for (const frame of options.frames) yield frame
    await gate.wait
  }
  return {
    connection: {
      frames: source(),
      ...(options.outbound ? { outbound: options.outbound } : {}),
      abort: () => {
        aborted += 1
        gate.open()
      },
    },
    abortedCount: () => aborted,
  }
}

interface InboundFixture {
  readonly frames: AsyncIterable<Frame>
  close(reason?: Error): void
  /** 客户端连接被关闭的次数。不变式是「至少一次」。 */
  closedCount(): number
}

function createInbound(frames: readonly Frame[]): InboundFixture {
  const gate = createGate()
  let closed = 0
  async function* source(): AsyncIterable<Frame> {
    for (const frame of frames) yield frame
    await gate.wait
  }
  return {
    frames: source(),
    close: () => {
      closed += 1
      gate.open()
    },
    closedCount: () => closed,
  }
}

interface RelayFixture extends UpstreamOptions {
  readonly inbound?: InboundFixture
  readonly modifiers?: readonly Modifier[]
  readonly observers?: readonly Observer[]
  /** 出口写到第 n 帧后关闭，用来模拟下游提前停止消费。 */
  readonly closeSinkAfterWrites?: number
}

function relay(fixture: RelayFixture) {
  const upstream = createUpstream(fixture)
  const sink = createSink(fixture.closeSinkAfterWrites ?? null)
  const exchange = createExchange()
  const started = relayConnected({
    request: exchange,
    exchange,
    attempt: ATTEMPT,
    target: createTarget(),
    sink,
    modifiers: fixture.modifiers ?? [],
    observers: fixture.observers ?? [],
    startedAt: Date.now(),
    connection: upstream.connection,
    ...(fixture.inbound ? { inbound: { frames: fixture.inbound.frames, close: fixture.inbound.close } } : {}),
  })
  return { started, sink, upstream }
}

describe('单工中继', () => {
  it('moves the upstream frames to the sink and reports no inbound direction', async () => {
    const { started, sink, upstream } = relay({
      frames: [HEAD, { kind: 'data', body: Buffer.from('hello') }, END],
    })

    const result = await started

    expect(sink.frames.map(frame => frame.kind)).toEqual(['head', 'data', 'end'])
    expect(result.frameCount).toBe(1)
    expect(result.byteCount).toBe(5)
    expect(result.ended).toBe(true)
    // 单工没有反方向，因此「谁先结束」这个问题只有一个答案。
    expect(result.firstEnded).toBe('response')
    expect(result.inbound).toBeNull()
    // 正常收尾的上游不该被主动断开。
    expect(upstream.abortedCount()).toBe(0)
  })

  it('aborts an upstream that never reached an end frame when the downstream stopped consuming', async () => {
    // 下游读完头帧就不要了（客户端取消、failover 提前放弃）。上游不会走到 `end`，不主动断开
    // 就会留下一条没人读、也没人会关的连接。
    //
    // 这里刻意不设任何计时：内核不给「沉默的上游」计时，断路只能来自「下游不要了」——
    // 收尾时那次断开是收尾，不是超时。
    const { started, sink, upstream } = relay({
      frames: [HEAD, { kind: 'data', body: Buffer.from('ignored') }],
      closeSinkAfterWrites: 1,
    })

    const result = await started

    // 下游拿到的只有头帧，之后的帧没有被搬过去。
    expect(sink.frames.map(frame => frame.kind)).toEqual(['head'])
    expect(result.stopped).toBe(true)
    expect(result.ended).toBe(false)
    expect(upstream.abortedCount()).toBe(1)
  })
})

describe('双向中继', () => {
  it('closes the client and aborts the upstream when the response side ends first', async () => {
    const inbound = createInbound([])
    const outbound = createSink()
    const { started, upstream } = relay({
      frames: [HEAD, { kind: 'data', body: Buffer.from('answer') }, END],
      outbound,
      inbound,
    })

    const result = await started

    expect(result.firstEnded).toBe('response')
    expect(result.inbound).not.toBeNull()
    expect(inbound.closedCount()).toBe(1)
    expect(upstream.abortedCount()).toBe(1)
  })

  it('reports the request side as the first to end and counts the frames it carried', async () => {
    const inbound = createInbound([{ kind: 'data', body: Buffer.from('question') }, END])
    const outbound = createSink()
    const { started, upstream } = relay({ frames: [HEAD], outbound, inbound })

    const result = await started

    expect(result.firstEnded).toBe('request')
    expect(result.inbound?.ended).toBe(true)
    expect(result.inbound?.frameCount).toBe(1)
    expect(result.inbound?.byteCount).toBe(8)
    expect(outbound.frames.map(frame => frame.kind)).toEqual(['data', 'end'])
    // 反方向先结束时上游必须被断开，否则会留下一条没人读的连接。
    expect(upstream.abortedCount()).toBe(1)
    expect(inbound.closedCount()).toBe(1)
  })

  it('aborts the upstream exactly once even when the pipe ended abnormally as well', async () => {
    // 上游只发了头帧就静默：`finally` 要兜底断开，而反方向先结束时已经断过一次。
    const inbound = createInbound([END])
    const outbound = createSink()
    const { started, upstream } = relay({ frames: [HEAD], outbound, inbound })

    await started

    expect(upstream.abortedCount()).toBe(1)
  })

  it('fails instead of silently dropping the client direction when the upstream has no write side', async () => {
    const inbound = createInbound([END])
    const { started, upstream } = relay({ frames: [HEAD], inbound })

    await expect(started).rejects.toThrow(/写入侧/)

    // 抛出也要把上游收干净。
    expect(upstream.abortedCount()).toBe(1)
  })
})

describe('建连与搬运的分工', () => {
  it('connects through the transport before relaying the connection it got back', async () => {
    const upstream = createUpstream({ frames: [HEAD, END] })
    const connect = vi.fn().mockResolvedValue(upstream.connection)
    const transport: Transport = { kind: 'http', connect }
    const exchange = createExchange()
    const target = createTarget()
    const sink = createSink()

    // `relayAttempt` 比 `relayConnected` 唯一多做的事就是「先建连」；搬运本身是同一份实现。
    const result = await relayAttempt({
      request: exchange,
      exchange,
      attempt: ATTEMPT,
      target,
      sink,
      modifiers: [],
      observers: [],
      startedAt: Date.now(),
      transport,
    })

    expect(connect).toHaveBeenCalledWith(target, exchange, ATTEMPT)
    expect(sink.frames.map(frame => frame.kind)).toEqual(['head', 'end'])
    expect(result.ended).toBe(true)
  })

  it('tells the observers that the attempt started and ended', async () => {
    const started = vi.fn()
    const ended = vi.fn()
    const observer: Observer = { id: 'test-observer', onAttemptStart: started, onAttemptEnd: ended }
    const { started: relayed } = relay({ frames: [HEAD, END], observers: [observer] })

    await relayed

    expect(started).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledTimes(1)
  })
})
