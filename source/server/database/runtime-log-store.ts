import type { LogEntry } from '@common/schemas'
import { getDb } from './index'

interface ListRuntimeLogsOptions {
  after?: number
  limit?: number
  offset?: number
  level?: LogEntry['level']
  searchText?: string
}

const DEFAULT_LIMIT = 500

type RuntimeLogRow = {
  id: number | bigint
  level: string
  message: string
  timestamp: number | bigint
}

interface RuntimeLogFilter {
  after?: number
  level?: LogEntry['level']
  searchText?: string
}

function mapLogRow(row: RuntimeLogRow): LogEntry {
  return {
    id: Number(row.id),
    level: row.level as LogEntry['level'],
    message: row.message,
    timestamp: Number(row.timestamp),
  }
}

export function createRuntimeLog(level: LogEntry['level'], message: string, timestamp = Date.now()): LogEntry {
  const result = getDb().$client
    .prepare('INSERT INTO runtime_logs (level, message, timestamp) VALUES (?, ?, ?)')
    .run(level, message, timestamp)

  return {
    id: Number(result.lastInsertRowid),
    level,
    message,
    timestamp,
  }
}

export function listRuntimeLogs(options?: ListRuntimeLogsOptions): LogEntry[] {
  const limit = options?.limit ?? DEFAULT_LIMIT
  const offset = options?.offset ?? 0
  const { whereClause, parameters } = buildRuntimeLogFilter({
    after: options?.after,
    level: options?.level,
    searchText: options?.searchText,
  })

  const rows = getDb().$client
    .prepare(`SELECT id, level, message, timestamp FROM runtime_logs${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...parameters, limit, offset) as RuntimeLogRow[]
  return rows.map(mapLogRow)
}

export function countRuntimeLogs(options?: Pick<ListRuntimeLogsOptions, 'level' | 'searchText'>): number {
  const { whereClause, parameters } = buildRuntimeLogFilter({
    level: options?.level,
    searchText: options?.searchText,
  })
  const row = getDb().$client
    .prepare(`SELECT COUNT(*) as total FROM runtime_logs${whereClause}`)
    .get(...parameters) as { total: number | bigint }
  return Number(row.total)
}

export function listAllRuntimeLogs(): LogEntry[] {
  const rows = getDb().$client
    .prepare('SELECT id, level, message, timestamp FROM runtime_logs ORDER BY id ASC')
    .all() as RuntimeLogRow[]
  return rows.map(mapLogRow)
}

export function clearRuntimeLogs(): void {
  getDb().$client.prepare('DELETE FROM runtime_logs').run()
}

export function pruneRuntimeLogsBefore(retentionDays: number): number {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) return 0
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const result = getDb().$client.prepare('DELETE FROM runtime_logs WHERE timestamp < ?').run(cutoff)
  return Number(result.changes)
}

function buildRuntimeLogFilter(filter?: RuntimeLogFilter) {
  const clauses: string[] = []
  const parameters: Array<number | string> = []

  if (filter?.after && filter.after > 0) {
    clauses.push('id > ?')
    parameters.push(filter.after)
  }

  if (filter?.level) {
    clauses.push('level = ?')
    parameters.push(filter.level)
  }

  const normalizedSearchText = filter?.searchText?.trim()
  if (normalizedSearchText) {
    clauses.push('instr(lower(message), lower(?)) > 0')
    parameters.push(normalizedSearchText)
  }

  return {
    whereClause: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    parameters,
  }
}
