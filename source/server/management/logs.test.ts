import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logRoutes } from './routes/observability/logs'
import { clearLogs, installLogCapture, listLogs } from './infrastructure/log-buffer'

function mockResponse() {
  return { statusCode: 0, headersSent: false, writableEnded: false, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse
}

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

describe('log routes', () => {
  beforeEach(() => {
    clearLogs()
    installLogCapture()
  })

  afterEach(() => {
    clearLogs()
  })

  it('lists, exports and clears the in-memory log buffer', async () => {
    console.info('hello from logs route test')
    console.warn('warn from logs route test')

    const listRes = mockResponse()
    await logRoutes.invoke('/api/logs/list', listRes, { limit: 1, offset: 0, level: 'warn', searchText: 'warn' })
    const listPayload = responseData(listRes) as { data: { logs: Array<{ message: string }>; total: number } }
    expect(listPayload.data.total).toBe(1)
    expect(listPayload.data.logs).toHaveLength(1)
    expect(listPayload.data.logs[0].message).toContain('warn from logs route test')

    const pagedRes = mockResponse()
    await logRoutes.invoke('/api/logs/list', pagedRes, { limit: 1, offset: 1 })
    const pagedPayload = responseData(pagedRes) as { data: { logs: Array<{ message: string }>; total: number } }
    expect(pagedPayload.data.total).toBeGreaterThan(1)
    expect(listPayload.data.logs.length).toBeGreaterThan(0)
    expect(pagedPayload.data.logs[0].message).toContain('hello from logs route test')

    const exportRes = mockResponse()
    await logRoutes.invoke('/api/logs/export', exportRes)
    const exportPayload = responseData(exportRes) as { data: { content: string } }
    expect(exportPayload.data.content).toContain('hello from logs route test')

    const clearRes = mockResponse()
    await logRoutes.invoke('/api/logs/clear', clearRes)
    expect(responseData(clearRes)).toEqual({ success: true, data: { cleared: true } })
    expect(listLogs()).toEqual([])
  })
})
