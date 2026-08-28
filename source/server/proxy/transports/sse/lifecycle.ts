import type { UpstreamResponse } from '../http'

export interface ResponseIdleTimeout {
  dispose(): void
}

export function attachResponseIdleTimeout(response: UpstreamResponse, timeoutMilliseconds: number): ResponseIdleTimeout {
  let timer: NodeJS.Timeout | null = null
  let disposed = false

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const armTimer = () => {
    clearTimer()
    if (timeoutMilliseconds <= 0 || disposed) return
    timer = setTimeout(() => {
      timer = null
      response.destroy(new Error('Idle timeout'))
    }, timeoutMilliseconds)
  }
  const dispose = () => {
    disposed = true
    clearTimer()
    response.removeListener('data', armTimer)
    response.removeListener('end', dispose)
    response.removeListener('close', dispose)
    response.removeListener('error', dispose)
  }

  response.on('data', armTimer)
  response.once('end', dispose)
  response.once('close', dispose)
  response.once('error', dispose)
  armTimer()

  return { dispose }
}
