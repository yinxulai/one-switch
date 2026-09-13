import type { IncomingHttpHeaders, OutgoingHttpHeaders, ServerResponse } from 'node:http'

/** 响应写出口的最小形状：只要能把字符串写出去并收尾，就能作为出口（含测试替身）。 */
export interface ResponseSink {
  readonly writableEnded: boolean
  write(chunk: string): void
  end(): void
}

/**
 * 代理响应出口。
 *
 * 只负责「把字节交给客户端」，不认识协议、不认识帧、不解析正文：
 * 协议差异在修改器里抹平，字节搬运在中继里完成，这里只做最后一步落地。
 */
export interface ProxyResponse extends ResponseSink {
  readonly headersSent: boolean
  readonly destroyed: boolean
  start(statusCode: number, headers: OutgoingHttpHeaders): void
  fail(statusCode: number, errorCode: string, errorMessage: string): string
  destroy(error: Error): void
  headers(): OutgoingHttpHeaders
}

export class NodeProxyResponse implements ProxyResponse {
  constructor(private readonly response: ServerResponse) {}

  get writableEnded(): boolean { return this.response.writableEnded }
  get headersSent(): boolean { return this.response.headersSent }
  get destroyed(): boolean { return this.response.destroyed }

  start(statusCode: number, headers: OutgoingHttpHeaders): void {
    if (!this.response.headersSent) this.response.writeHead(statusCode, headers)
  }

  write(chunk: string): void { this.response.write(chunk) }
  end(): void { this.response.end() }
  destroy(error: Error): void { this.response.destroy(error) }
  headers(): OutgoingHttpHeaders { return this.response.getHeaders() }

  fail(statusCode: number, errorCode: string, errorMessage: string): string {
    const body = JSON.stringify({ success: false, errorCode, errorMessage })
    this.response.statusCode = statusCode
    this.response.setHeader('Content-Type', 'application/json')
    this.response.end(body)
    return body
  }
}

export class BufferedProxyResponse implements ProxyResponse {
  private chunks: string[] = []
  private responseHeaders: OutgoingHttpHeaders = {}
  private status = 0
  private ended = false
  private failure: Error | null = null

  get writableEnded(): boolean { return this.ended }
  get headersSent(): boolean { return this.status !== 0 }
  get destroyed(): boolean { return this.failure !== null }
  get statusCode(): number { return this.status }
  get body(): string { return this.chunks.join('') }
  get failureMessage(): string | undefined { return this.failure?.message }

  start(statusCode: number, headers: OutgoingHttpHeaders): void {
    if (this.headersSent) return
    this.status = statusCode
    this.responseHeaders = { ...headers }
  }

  write(chunk: string): void { this.chunks.push(chunk) }
  end(): void { this.ended = true }
  destroy(error: Error): void { this.failure = error; this.ended = true }
  headers(): OutgoingHttpHeaders { return this.responseHeaders }

  fail(statusCode: number, errorCode: string, errorMessage: string): string {
    const body = JSON.stringify({ success: false, errorCode, errorMessage })
    this.start(statusCode, { 'content-type': 'application/json' })
    this.write(body)
    this.end()
    return body
  }
}

export function asIncomingHeaders(headers: OutgoingHttpHeaders): IncomingHttpHeaders {
  return headers as IncomingHttpHeaders
}
