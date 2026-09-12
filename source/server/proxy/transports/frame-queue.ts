import type { Frame } from '@server/proxy/contracts'

/** 队列只需要暂停/恢复两个方法，不必把 `http.IncomingMessage` 的重类型引进来。 */
export interface PausableStream {
  pause(): void
  resume(): void
}

/**
 * 事件式来源 → 可拉取的帧序列。
 *
 * 只保留 `head` 之前不可拉取、之后严格单向的语义：消费者一次拿一帧，拿不到就挂起。
 * 来源支持暂停时（HTTP 响应流），队列里有货就暂停来源，被取空再恢复，避免把整条响应
 * 读进内存；来源没有暂停原语时（例如只有事件、没有流控的长连接），队列退化为纯缓冲区。
 * 这是两种来源形态在「不缓冲」这条不变量上唯一的差别，由传输自己说明，不藏在队列里。
 */
export class FrameQueue implements AsyncIterable<Frame> {
  private readonly pending: Frame[] = []
  private readonly waiters: Array<(frame: Frame | null) => void> = []
  private stream: PausableStream | null = null
  private ended = false
  private paused = false

  get closed(): boolean {
    return this.ended
  }

  bind(stream: PausableStream): void {
    this.stream = stream
  }

  push(frame: Frame): void {
    if (this.ended) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(frame)
      return
    }
    this.pending.push(frame)
    this.pauseUpstream()
  }

  /** 源已终止：唤醒所有等待者，之后的 `push` 一律丢弃。 */
  finish(): void {
    if (this.ended) return
    this.ended = true
    this.resumeUpstream()
    for (const waiter of this.waiters.splice(0)) waiter(null)
  }

  /** 消费者提前退出：丢掉剩余帧。 */
  cancel(): void {
    if (this.ended) return
    this.pending.length = 0
    this.finish()
  }

  [Symbol.asyncIterator](): AsyncIterator<Frame> {
    return {
      next: async (): Promise<IteratorResult<Frame>> => {
        if (this.pending.length > 0) {
          const frame = this.pending.shift() as Frame
          if (this.pending.length === 0) this.resumeUpstream()
          return { done: false, value: frame }
        }
        if (this.ended) return { done: true, value: undefined }
        const frame = await new Promise<Frame | null>(resolveWaiter => this.waiters.push(resolveWaiter))
        if (frame === null) return { done: true, value: undefined }
        return { done: false, value: frame }
      },
      return: async (): Promise<IteratorResult<Frame>> => {
        this.cancel()
        return { done: true, value: undefined }
      },
    }
  }

  private pauseUpstream(): void {
    if (this.paused || !this.stream) return
    this.paused = true
    this.stream.pause()
  }

  private resumeUpstream(): void {
    if (!this.paused || !this.stream) return
    this.paused = false
    this.stream.resume()
  }
}
