import type { AttemptView, ExchangeView, HeadFrame, HeaderMap, Observer } from '@server/proxy/contracts'
import { isStreamingDelivery, serializeStreamingChunks } from '@server/proxy/adapters/http-response-sink'
import { createUsageTracker, type ExtractedUsage } from './usage'

export interface AttemptObserverOptions {
  exchange: ExchangeView
  attempt: AttemptView
  /** 是否把上游字节留存下来（关掉时只保留原文，用于判定流式与错误分类）。 */
  captureEnabled: boolean
  /** 尝试开始时刻，TTFT 相对它计算。 */
  startedAt: number
}

/**
 * 一次尝试的观察者：把「上游怎么回的」变成可落库的事实。
 *
 * 它是响应侧唯一的字节读者，因此也是替换 `ResponsePipeline` 里那半份观测职责的落点：
 * 用量、TTFT、上游视角正文都从这里出，而出口只负责把字节写出去。两者共享同一个
 * 流式判定（{@link isStreamingDelivery}），所以上游视角与客户端视角永远同形。
 *
 * 观察者不改任何字节，也不影响转发结果——它抛错只会丢掉自己的记录。
 */
export interface AttemptObserver extends Observer {
  /** 上游响应头投影；尚未收到时为 `null`。 */
  head(): HeadFrame | null
  /** 「客户端要流式 + 上游以 SSE 返回」。 */
  streaming(): boolean
  /** 上游视角正文；流式是分块快照，非流式是原文。 */
  upstreamBody(): string | null
  /** 原文字节；流式下发时为完整 SSE 文本（与分块快照相对，用于健康度判定）。 */
  rawBody(): string | null
  /** 出错时用的上游视角正文：已经收到的部分照记。 */
  partialUpstreamBody(): string | null
  /** 上游上报的用量。 */
  usage(): ExtractedUsage
  /** 首字节时延；上游没有真实输出时为 `null`。 */
  ttftMilliseconds(): number | null
}

export function createAttemptObserver(options: AttemptObserverOptions): AttemptObserver {
  return new ObserverState(options)
}

class ObserverState implements AttemptObserver {
  readonly id = 'attempt-observer'
  private readonly options: AttemptObserverOptions
  private readonly tracker = createUsageTracker()
  private readonly upstreamChunks: string[] = []
  private headFrame: HeadFrame | null = null
  private streamingResponse = false
  private raw = ''
  private firstOutputAt: number | null = null

  constructor(options: AttemptObserverOptions) {
    this.options = options
  }

  head(): HeadFrame | null {
    return this.headFrame
  }

  streaming(): boolean {
    return this.streamingResponse
  }

  upstreamBody(): string | null {
    if (this.streamingResponse) return serializeStreamingChunks(this.upstreamChunks)
    return this.raw || null
  }

  rawBody(): string | null {
    return this.raw || null
  }

  partialUpstreamBody(): string | null {
    return this.upstreamBody()
  }

  usage(): ExtractedUsage {
    return this.tracker.usage()
  }

  ttftMilliseconds(): number | null {
    return this.firstOutputAt === null ? null : this.firstOutputAt - this.options.startedAt
  }

  onUpstreamHead(exchange: ExchangeView, _attempt: AttemptView, status: number, headers: HeaderMap): void {
    // 这里拿到的始终是上游原始头：修改器可能已经改写过头帧，但「上游怎么回的」不该被改写。
    this.headFrame = { kind: 'head', status, headers }
    this.streamingResponse = isStreamingDelivery(exchange.delivery, headers)
  }

  onUpstreamChunk(_exchange: ExchangeView, _attempt: AttemptView, chunk: Buffer): void {
    const text = chunk.toString('utf8')
    this.raw += text
    if (this.options.captureEnabled) this.upstreamChunks.push(text)
    // 非流式正文在收尾时一次性解析：中途的半截 JSON 解析不出任何东西。
    if (!this.streamingResponse) return
    if (this.tracker.consumeSseChunk(text)) this.markFirstOutput()
  }

  onAttemptEnd(_exchange: ExchangeView, _attempt: AttemptView): void {
    if (this.streamingResponse) {
      if (this.tracker.flush()) this.markFirstOutput()
      return
    }
    this.tracker.consumeJson(this.raw)
  }

  private markFirstOutput(): void {
    if (this.firstOutputAt === null) this.firstOutputAt = Date.now()
  }
}
