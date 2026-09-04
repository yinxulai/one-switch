import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  ChevronRight,
  GripVertical,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react'
import type { Provider, ProviderHealth, ProviderModelHealth, ProviderModelRoute } from '@common/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProtocolIcons } from '@/components/protocol-icons'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { QueueModelMetrics } from '../lib/model-metrics'

interface QueueModelRowProps {
  model: ProviderModelRoute
  provider?: Provider
  providerHealth?: ProviderHealth
  providerModelHealth?: ProviderModelHealth
  metrics?: QueueModelMetrics
  mode: 'auto' | 'manual'
  selected: boolean
  cooling: boolean
  dragging: boolean
  dragHandleProps: Record<string, unknown>
  onSelect: () => void
  onToggleEnabled: (enabled: boolean) => void
  onNavigateToProviderAnalytics?: (providerId: string) => void
  onRemove: () => void
}

type HealthSource = 'model' | 'provider-fallback' | 'none'

export interface QueueModelHealthDisplay {
  source: HealthSource
  consecutiveFailures: number
  lastSuccessTime: number | null
}

function formatRelativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  const difference = Date.now() - timestamp
  if (difference < 60_000) return `${Math.floor(difference / 1000)} 秒前`
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`
  return `${Math.floor(difference / 86_400_000)} 天前`
}

function formatAverageTps(tps: number | null | undefined): string {
  if (tps == null) return '—'
  return tps >= 10 ? String(Math.round(tps)) : tps.toFixed(1)
}

function formatAverageTtft(milliseconds: number | null | undefined): string {
  if (milliseconds == null) return '—'
  return `${(milliseconds / 1000).toFixed(2)}s`
}

function hasHealthSignal(health: ProviderHealth | ProviderModelHealth | undefined): boolean {
  if (!health) return false
  return Boolean(
    health.consecutiveFailures > 0
    || health.lastSuccessTime
    || health.lastFailureTime
    || health.cooldownUntilTime,
  )
}

export function resolveQueueModelHealthDisplay(props: Pick<QueueModelRowProps, 'providerHealth' | 'providerModelHealth'>): QueueModelHealthDisplay {
  if (hasHealthSignal(props.providerModelHealth)) {
    return {
      source: 'model',
      consecutiveFailures: props.providerModelHealth?.consecutiveFailures ?? 0,
      lastSuccessTime: props.providerModelHealth?.lastSuccessTime ?? null,
    }
  }

  if (hasHealthSignal(props.providerHealth)) {
    return {
      source: 'provider-fallback',
      consecutiveFailures: props.providerHealth?.consecutiveFailures ?? 0,
      lastSuccessTime: props.providerHealth?.lastSuccessTime ?? null,
    }
  }

  return {
    source: 'none',
    consecutiveFailures: 0,
    lastSuccessTime: null,
  }
}

function ModelHealth(props: Pick<QueueModelRowProps, 'providerHealth' | 'providerModelHealth'>) {
  const healthDisplay = resolveQueueModelHealthDisplay(props)
  const failures = healthDisplay.consecutiveFailures
  const lastSuccessTime = healthDisplay.lastSuccessTime
  const isProviderFallback = healthDisplay.source === 'provider-fallback'

  if (failures > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
        <AlertTriangle size={11} />
        {isProviderFallback ? '供应商连续失败' : '连续失败'} {failures} 次
      </span>
    )
  }
  if (lastSuccessTime) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
        <CheckCircle2 size={11} />
        {isProviderFallback ? '供应商最后成功' : '最后成功'} {formatRelativeTime(lastSuccessTime)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Clock size={11} />
      暂无请求记录
    </span>
  )
}

export function QueueModelRow(props: QueueModelRowProps) {
  const { model } = props

  return (
    <div
      onClick={props.onSelect}
      className={cn(
        'group/row grid min-h-14 min-w-88 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-1 overflow-hidden border-b border-border/60 border-l-2 border-l-transparent px-3 py-2 last:border-b-0 transition-colors hover:bg-muted/20',
        props.selected && 'rounded-md border-l-primary bg-primary/5',
        props.mode === 'manual' && 'cursor-pointer',
        props.dragging && 'rounded-md bg-muted/60',
      )}
    >
      <div className="min-w-0">
        <div
          className="flex min-h-9 w-full cursor-grab touch-none select-none items-center gap-2 rounded-md px-1.5 text-muted-foreground/70 active:cursor-grabbing"
          {...(props.mode === 'auto' ? props.dragHandleProps : {})}
          aria-label={props.mode === 'auto' ? `拖动 ${model.modelName}` : undefined}
        >
          {props.mode === 'manual' ? (
            props.selected ? <CircleDot size={16} className="text-primary" /> : <Circle size={16} className="text-muted-foreground/40" />
          ) : (
            <GripVertical size={16} />
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
            {props.provider && props.onNavigateToProviderAnalytics ? (
              <button
                type="button"
                className="group/provider inline-flex min-w-0 items-center gap-0.5 rounded-sm text-left font-medium text-foreground/90 outline-none transition-colors hover:text-primary focus-visible:bg-primary/10 focus-visible:text-primary"
                title={`查看 ${props.provider.name} 数据分析`}
                aria-label={`查看 ${props.provider.name} 数据分析`}
                onClick={event => {
                  event.stopPropagation()
                  props.onNavigateToProviderAnalytics?.(model.providerId)
                }}
              >
                <span className="min-w-0 truncate">{props.provider.name}</span>
                <span className="shrink-0 text-muted-foreground/50" aria-hidden="true">·</span>
                <span className="min-w-0 truncate font-mono text-foreground/90">{model.modelName}</span>
                <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-muted-foreground/60 transition-transform group-hover/provider:translate-x-0.5 group-hover/provider:text-primary group-focus-visible/provider:text-primary" />
              </button>
            ) : (
              <>
                <div className="min-w-0 truncate font-medium">{props.provider?.name ?? '未知供应商'}</div>
                <span className="shrink-0 text-muted-foreground/50" aria-hidden="true">·</span>
                <div className="min-w-0 truncate font-mono text-foreground/90">{model.modelName}</div>
              </>
            )}
          </div>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
          <ProtocolIcons endpoints={model.endpoints} />
          <span className="shrink-0 text-muted-foreground/40" aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1"><Zap size={10} />TPS {formatAverageTps(props.metrics?.avgTps)}</span>
          <span className="inline-flex items-center gap-1"><Timer size={10} />TTFT {formatAverageTtft(props.metrics?.avgTtftMilliseconds)}</span>
          <ModelHealth providerHealth={props.providerHealth} providerModelHealth={props.providerModelHealth} />
        </div>
      </div>
      <div className="relative flex min-w-20 items-center justify-end">
        <Badge variant={props.cooling ? 'destructive' : model.enabled ? 'success' : 'muted'}>{props.cooling ? '冷却中' : model.enabled ? (props.selected ? '当前指定' : '待命') : '已禁用'}</Badge>
        <div className="absolute top-1/2 right-0 flex -translate-y-1/2 translate-x-3 items-center gap-1 rounded-md bg-card px-1.5 py-0.5 opacity-0 transition-all group-hover/row:translate-x-0 group-hover/row:opacity-100 focus-within:translate-x-0 focus-within:opacity-100">
          <Switch checked={model.enabled} onCheckedChange={props.onToggleEnabled} onClick={event => event.stopPropagation()} aria-label={`${model.modelName} 启用状态`} />
          <Button variant="ghost" size="icon-sm" onClick={event => { event.stopPropagation(); props.onRemove() }} aria-label={`从队列移除 ${model.modelName}`} title="从队列移除"><Trash2 size={16} /></Button>
        </div>
      </div>
    </div>
  )
}
