import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import type { LogEntry } from '@common/schemas'
import { clearLogs, countLogs, exportLogs, listLogs } from '../../infrastructure/log-buffer'
import { HttpRouter } from '@server/http-router'

export const logRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/logs/list', handleListLogs)
  .post('/api/logs/export', handleExportLogs)
  .post('/api/logs/clear', handleClearLogs)

const ListLogsSchema = z.object({
  after: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
  level: z.enum(['error', 'warn', 'info', 'log', 'debug']).optional(),
  searchText: z.string().trim().max(200).optional(),
})

function handleListLogs(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { after, limit, offset, level, searchText } = ListLogsSchema.parse(body)
  const logs: LogEntry[] = listLogs({ after, limit, offset, level, searchText })
  const total = countLogs({ level, searchText })
  sendSuccess(res, { logs, total })
}

function handleExportLogs(_req: IncomingMessage, res: ServerResponse): void {
  sendSuccess(res, { content: exportLogs() })
}

function handleClearLogs(_req: IncomingMessage, res: ServerResponse): void {
  clearLogs()
  sendSuccess(res, { cleared: true })
}
