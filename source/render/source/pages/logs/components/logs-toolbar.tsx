import { Download, Pause, Play, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { LogEntry } from '@common/schemas'
import { FilterBar } from '@/components/filter-bar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type LevelFilter = 'all' | LogEntry['level']
interface LogsToolbarProps {
  total: number; live: boolean; refreshing: boolean; levelFilter: LevelFilter; searchText: string; clearDialogOpen: boolean
  onLiveChange: () => void; onRefresh: () => void; onExport: () => void; onClear: () => void; onDialogChange: (open: boolean) => void
  onLevelChange: (value: LevelFilter) => void; onSearchChange: (value: string) => void
}

export function LogsToolbar(props: LogsToolbarProps) {
  return <FilterBar>
    <div className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden /><Input value={props.searchText} onChange={event => props.onSearchChange(event.target.value)} placeholder="搜索日志内容..." className="w-72 pl-9" aria-label="搜索日志内容" /></div>
    <Select value={props.levelFilter} onValueChange={value => props.onLevelChange(value as LevelFilter)}><SelectTrigger aria-label="按日志级别筛选" className="w-32"><SelectValue placeholder="全部级别" /></SelectTrigger><SelectContent><SelectItem value="all">全部级别</SelectItem><SelectItem value="error">ERROR</SelectItem><SelectItem value="warn">WARN</SelectItem><SelectItem value="info">INFO</SelectItem><SelectItem value="log">LOG</SelectItem><SelectItem value="debug">DEBUG</SelectItem></SelectContent></Select>
    <span className="system-xs-regular text-text-tertiary">共 {props.total} 条</span>
    <span className={cn('ml-auto flex items-center gap-1.5 system-xs-regular', props.live ? 'text-text-success' : 'text-text-tertiary')}><span className="relative flex size-2 shrink-0 items-center justify-center">{props.live && <span className="absolute size-2 rounded-full bg-success/50 motion-safe:animate-ping" />}<span className={cn('relative size-1.5 rounded-full', props.live ? 'bg-success' : 'bg-text-quaternary')} /></span>{props.live ? '实时更新' : '已暂停'}</span>
    <Button variant="outline" onClick={props.onLiveChange}>{props.live ? <Pause size={14} /> : <Play size={14} />}{props.live ? '暂停' : '继续'}</Button>
    <Button variant="outline" size="icon" title="刷新日志" aria-label="刷新日志" onClick={props.onRefresh} disabled={props.refreshing}><RefreshCw size={14} className={cn(props.refreshing && 'animate-spin')} /></Button>
    <Button variant="outline" size="icon" title="导出日志" aria-label="导出日志" onClick={props.onExport}><Download size={14} /></Button>
    <Button variant="ghost" size="icon" title="清空日志" aria-label="清空日志" disabled={props.total === 0} onClick={() => props.onDialogChange(true)}><Trash2 size={14} /></Button>
    <ConfirmDialog open={props.clearDialogOpen} title="清空运行日志？" description="这会删除本次进程中已捕获的全部运行日志，操作无法撤销。" confirmLabel="清空日志" variant="destructive" onConfirm={props.onClear} onOpenChange={props.onDialogChange} />
  </FilterBar>
}
