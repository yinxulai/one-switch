import type { LogEntry } from '@common/schemas'
import { AlertTriangle, Inbox, RefreshCw, SearchX } from 'lucide-react'
import { tableCellClass, tableHeaderCellClass, tableHeaderClass, tableRowClass, TableFrame } from '@/components/table-primitives'
import { TableStateRow } from '@/components/table-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

const LEVEL_STYLE: Record<LogEntry['level'], string> = {
  error: 'bg-destructive/10 text-text-destructive',
  warn: 'bg-warning/10 text-text-warning',
  info: 'bg-info/10 text-info',
  log: 'bg-inset text-text-tertiary',
  debug: 'bg-inset text-text-quaternary',
}
const LEVEL_LABEL: Record<LogEntry['level'], string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  log: 'LOG',
  debug: 'DEBUG',
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  }).format(timestamp)
}

function renderLoadingRows() {
  return Array.from({ length: 10 }).map((_, index) => (
    <TableRow key={index} className={tableRowClass}>
      <TableCell className="px-3 py-2.5">
        <Skeleton className="h-3 w-28" />
      </TableCell>
      <TableCell className="px-3 py-2.5">
        <Skeleton className="h-5 w-14" />
      </TableCell>
      <TableCell className="px-3 py-2.5">
        <Skeleton className="h-3 w-4/5" />
      </TableCell>
    </TableRow>
  ))
}

function renderEmptyRow(filtered: boolean) {
  if (filtered) {
    return <TableStateRow colSpan={3} icon={SearchX} title="没有匹配的运行日志" description="试着放宽搜索词或把级别筛选切回「全部级别」。" />
  }

  return <TableStateRow colSpan={3} icon={Inbox} title="还没有运行日志" description="服务产生日志后会实时出现在这里。" />
}

function renderErrorRow(message: string, onRetry: () => void) {
  return (
    <TableStateRow colSpan={3} icon={AlertTriangle} tone="destructive" title="运行日志读取失败" description={message} action={
      <Button variant="outline" className="mt-1" onClick={onRetry}>
        <RefreshCw size={14} />
        重试
      </Button>
    } />
  )
}

function renderLogRows(logs: LogEntry[]) {
  return logs.map(log => (
    <TableRow key={log.id} className={cn(tableRowClass, 'align-top')}>
      <TableCell className={cn(tableCellClass, 'whitespace-nowrap font-mono text-text-quaternary')}>
        {formatTimestamp(log.timestamp)}
      </TableCell>
      <TableCell className={tableCellClass}>
        <Badge variant="outline" className={cn('h-5 border-transparent px-1.5 font-mono system-2xs-medium', LEVEL_STYLE[log.level])}>
          {LEVEL_LABEL[log.level]}
        </Badge>
      </TableCell>
      <TableCell className={cn(tableCellClass, 'whitespace-pre-wrap break-words font-mono text-text-secondary')}>{log.message}</TableCell>
    </TableRow>
  ))
}

interface LogsTableProps { logs: LogEntry[]; loading: boolean; error: string | null; filtered: boolean; onRetry: () => void }

export function LogsTable(props: LogsTableProps) {
  const { logs, loading } = props

  const renderTableBody = () => {
    if (loading) return renderLoadingRows()
    if (props.error !== null && logs.length === 0) return renderErrorRow(props.error, props.onRetry)
    if (logs.length === 0) return renderEmptyRow(props.filtered)
    return renderLogRows(logs)
  }

  return (
    <TableFrame>
      <div className="max-h-[calc(100vh-190px)] overflow-auto">
        <Table className="w-full table-fixed text-xs">
          <TableHeader className={cn('sticky top-0 z-10 bg-card/95 backdrop-blur-sm', tableHeaderClass)}>
            <TableRow className="h-8">
              <TableHead className={cn(tableHeaderCellClass, 'h-auto w-40 py-1.5')}>时间</TableHead>
              <TableHead className={cn(tableHeaderCellClass, 'h-auto w-20 py-1.5')}>级别</TableHead>
              <TableHead className={cn(tableHeaderCellClass, 'h-auto py-1.5')}>消息</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{renderTableBody()}</TableBody>
        </Table>
      </div>
    </TableFrame>
  )
}
