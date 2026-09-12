import type { DeliveryMode, Frame, FrameSink, HeadFrame, HeaderMap } from '@server/proxy/contracts'
import type { ProxyResponse } from '@server/proxy/response/proxy-response'

/**
 * 出口策略：客户端要增量交付 **且** 上游确实以 SSE 返回时，才边收边发。
 *
 * 两个条件缺一不可，而且它们是两根轴上的事实：前者是客户端意图（`DeliveryMode`），
 * 后者是上游响应头。只看这两个事实，不看协议、不看适配器：协议差异已经在修改器里被抹平——
 * 转换器把上游报文换成客户端协议之后，这里拿到的仍然是「客户端要不要增量」+「上游是不是 SSE」。
 * 缺了前半段（客户端没要）就必须攒完再发，否则会把 SSE 字节配上 JSON 语义发出去。
 */
export function isStreamingDelivery(delivery: DeliveryMode, headers: HeaderMap): boolean {
  return delivery === 'stream' && isEventStreamResponse(headers)
}

export function isEventStreamResponse(headers: HeaderMap): boolean {
  return String(headers['content-type'] ?? '').includes('text/event-stream')
}

/**
 * 分块快照的落库格式。流式正文不存原文而存分块列表，才能复现「逐块到达」的时序。
 *
 * 出口与观察者共用这一份定义：两边都得把「收到的字节」表示成同一个形状，
 * 否则同一次请求的上游视角与客户端视角会长得不一样。
 */
export function serializeStreamingChunks(chunks: readonly string[]): string {
  return JSON.stringify({ schemaVersion: 1, chunks })
}

export interface HttpResponseSinkOptions {
  response: ProxyResponse
  /** 客户端要求的交付方式。 */
  delivery: DeliveryMode
  /** 是否记录写出的字节。关闭时只保留缓冲分支的兜底正文。 */
  captureEnabled: boolean
}

/**
 * 帧出口：把内核吐出的帧写到 HTTP 响应上。
 *
 * 这是内核与 `ProxyResponse` 的唯一接触面，也是「出口不认识协议」的落点：
 * - 缓冲分支把数据帧攒起来，在 `end` 时一次性写完（内容可能已被修改器改写，
 *   因此 `content-length` 由头修改器提前删掉，交给 Node 重新分帧）；
 * - 流式分支在头帧落地时就 `start()`，之后逐帧写出，让首字节尽快到达客户端；
 * - `discard()` 用于 failover：这次尝试的响应一个字节都不该给客户端，但帧仍然照常流过
 *   观察者，日志里照样能看到上游返回了什么。
 */
export interface HttpResponseSink extends FrameSink {
  /** 放弃交付（failover 提前放弃）：之后不再写任何字节。 */
  discard(): void
  /** 客户端视角已写出的正文；从未写出时为 `null`。 */
  downstreamBody(): string | null
  /** 已写出的部分正文；未采集或尚未写出任何内容时为 `null`。 */
  partialDownstreamBody(): string | null
  /** 交付过程中观察到的失败。 */
  failure(): Error | null
}

export function createHttpResponseSink(options: HttpResponseSinkOptions): HttpResponseSink {
  return new HttpFrameSink(options)
}

class HttpFrameSink implements HttpResponseSink {
  private readonly options: HttpResponseSinkOptions
  private head: HeadFrame | null = null
  private streaming = false
  private discarded = false
  private finished = false
  private failed: Error | null = null
  private readonly captured: string[] = []
  private readonly buffered: string[] = []
  private bufferedWritten: string | null = null

  constructor(options: HttpResponseSinkOptions) {
    this.options = options
  }

  get closed(): boolean {
    return this.finished
  }

  write(frame: Frame): void {
    if (this.finished || this.discarded) return
    if (frame.kind === 'head') {
      this.head = frame
      this.streaming = isStreamingDelivery(this.options.delivery, frame.headers)
      if (this.streaming) this.startDownstream()
      return
    }
    if (frame.kind === 'data') {
      const text = frame.body.toString('utf8')
      if (this.streaming) this.writeDownstream(text)
      else this.buffered.push(text)
      return
    }
    if (frame.kind === 'error') {
      // 交付中途失败不在这里收尾：向上游报告失败、由执行器决定是销毁响应还是 failover。
      this.failed = frame.error
      this.finished = true
      return
    }
    this.finish()
  }

  discard(): void {
    this.discarded = true
  }

  downstreamBody(): string | null {
    if (this.streaming) return serializeStreamingChunks(this.captured)
    return this.captured.join('') || this.bufferedWritten
  }

  partialDownstreamBody(): string | null {
    return this.captured.length > 0 ? this.captured.join('') : null
  }

  failure(): Error | null {
    return this.failed
  }

  private startDownstream(): void {
    const sink = this.options.response
    if (sink.writableEnded || sink.headersSent || !this.head) return
    sink.start(this.head.status, this.head.headers)
  }

  private finish(): void {
    this.finished = true
    const head = this.head
    if (!head || this.discarded) return
    const body = this.buffered.join('')
    // 已写出的正文与响应是否还能写无关：客户端视角的记录不该因为连接已关闭而消失。
    if (!this.streaming) this.bufferedWritten = body || null
    const sink = this.options.response
    if (sink.writableEnded) return
    if (this.streaming) {
      sink.end()
      return
    }
    if (!sink.headersSent) sink.start(head.status, head.headers)
    if (body) this.writeDownstream(body)
    sink.end()
  }

  private writeDownstream(chunk: string): void {
    // 已经收尾的响应不能再写；此时连「客户端视角」也不该记账，因为它并没有收到。
    if (this.options.response.writableEnded) return
    if (this.options.captureEnabled) this.captured.push(chunk)
    this.options.response.write(chunk)
  }
}
