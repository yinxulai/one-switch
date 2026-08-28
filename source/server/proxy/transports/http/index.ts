import http from 'node:http'
import https from 'node:https'

export type UpstreamRequestOptions = http.RequestOptions
export type UpstreamResponse = http.IncomingMessage
export type UpstreamResponseHeaders = http.IncomingHttpHeaders

export interface TransportHooks {
  onResponse(response: UpstreamResponse): void
  onError(error: Error): void
  onTimeout(request: http.ClientRequest): void
}

export interface BufferedUpstreamResponse {
  statusCode: number
  headers: UpstreamResponseHeaders
  body: string
}

export function sendUpstreamRequest(url: URL, options: UpstreamRequestOptions, body: Buffer, hooks: TransportHooks | ((response: UpstreamResponse) => void)): http.ClientRequest {
  const transport = url.protocol === 'https:' ? https : http
  const normalizedHooks: TransportHooks = typeof hooks === 'function'
    ? { onResponse: hooks, onError: () => undefined, onTimeout: request => request.destroy(new Error('Connection timeout')) }
    : hooks
  const request = transport.request(options, normalizedHooks.onResponse)
  request.on('error', normalizedHooks.onError)
  request.on('timeout', () => normalizedHooks.onTimeout(request))
  if (body.length > 0) request.write(body)
  request.end()
  return request
}

export function requestBufferedUpstream(url: URL, options: UpstreamRequestOptions, body: Buffer): Promise<BufferedUpstreamResponse> {
  return new Promise((resolve, reject) => {
    let responseBody = ''
    sendUpstreamRequest(url, options, body, {
      onResponse: response => {
        response.on('data', chunk => { responseBody += chunk.toString('utf8') })
        response.on('end', () => resolve({
          statusCode: response.statusCode ?? 502,
          headers: response.headers,
          body: responseBody,
        }))
        response.on('error', reject)
      },
      onError: reject,
      onTimeout: request => request.destroy(new Error('Connection timeout')),
    })
  })
}
