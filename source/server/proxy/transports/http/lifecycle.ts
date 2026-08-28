import type http from 'node:http'

export interface DownstreamAbortBinding {
  dispose(): void
}

export function attachDownstreamAbort(request: http.IncomingMessage, response: http.ServerResponse, providerRequest: http.ClientRequest, onAbort: () => void): DownstreamAbortBinding {
  let disposed = false
  const abort = () => {
    if (disposed) return
    disposed = true
    providerRequest.destroy(new Error('CLIENT_REQUEST_ABORTED'))
    onAbort()
  }
  const onResponseClose = () => {
    if (!response.writableEnded) abort()
  }
  const dispose = () => {
    disposed = true
    request.removeListener('aborted', abort)
    response.removeListener('close', onResponseClose)
  }

  request.once('aborted', abort)
  response.once('close', onResponseClose)
  return { dispose }
}
