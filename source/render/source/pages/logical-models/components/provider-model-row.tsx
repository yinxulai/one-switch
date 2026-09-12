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
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import type { ProviderModelMetrics } from '../lib/model-metrics'

interface ProviderModelRowProps {
  model: ProviderModelRoute
  provider?: Provider
  providerHealth?: ProviderHealth
  providerModelHealth?: ProviderModelHealth
  metrics?: ProviderModelMetrics
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

export interface ProviderModelHealthDisplay {
  source: HealthSource
  consecutiveFailures: number
  lastSuccessTime: number | null
}

function formatRelativeTime(t: AppTranslator, timestamp: number | null | undefined): string {
  if (!timestamp) return '—'
  const difference = Date.now() - timestamp
  if (difference < 60_000) return t('logicalModels.row.secondsAgo', { count: Math.floor(difference / 1000) })
  if (difference < 3_600_000) return t('logicalModels.row.minutesAgo', { count: Math.floor(difference / 60_000) })
  if (difference < 86_400_000) return t('logicalModels.row.hoursAgo', { count: Math.floor(difference / 3_600_000) })
  return t('logicalModels.row.daysAgo', { count: Math.floor(difference / 86_400_000) })
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

export function resolveProviderModelHealthDisplay(props: Pick<ProviderModelRowProps, 'providerHealth' | 'providerModelHealth'>): ProviderModelHealthDisplay {
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

function ModelHealth(props: Pick<ProviderModelRowProps, 'providerHealth' | 'providerModelHealth'>) {
  const t = useTranslation()
  const healthDisplay = resolveProviderModelHealthDisplay(props)
  const failures = healthDisplay.consecutiveFailures
  const lastSuccessTime = healthDisplay.lastSuccessTime
  const isProviderFallback = healthDisplay.source === 'provider-fallback'

  if (failures > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-text-warning">
        <AlertTriangle size={11} aria-hidden />
        {isProviderFallback ? t('logicalModels.row.providerFailures', { count: failures }) : t('logicalModels.row.modelFailures', { count: failures })}
      </span>
    )
  }
  if (lastSuccessTime) {
    return (
      <span className="inline-flex items-center gap-1 text-text-success">
        <CheckCircle2 size={11} aria-hidden />
        {isProviderFallback ? t('logicalModels.row.providerLastSuccess', { time: formatRelativeTime(t, lastSuccessTime) }) : t('logicalModels.row.modelLastSuccess', { time: formatRelativeTime(t, lastSuccessTime) })}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Clock size={11} aria-hidden />
      {t('logicalModels.row.noRequests')}
    </span>
  )
}

export function ProviderModelRow(props: ProviderModelRowProps) {
  const { model } = props
  const t = useTranslation()

  return (
    <div
      onClick={props.onSelect}
      className={cn(
        'group/row grid min-h-14 min-w-88 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-1 overflow-hidden border-b border-border/50 border-l-2 border-l-transparent px-3 py-2 last:border-b-0 transition-colors hover:bg-state-base-hover',
        props.selected && 'border-l-primary bg-accent',
        props.mode === 'manual' && 'cursor-pointer',
        props.dragging && 'bg-state-base-hover-alt',
      )}
    >
      <div className="min-w-0">
        <div
          className="flex min-h-9 w-full cursor-grab touch-none select-none items-center gap-2 rounded-md px-1.5 text-text-quaternary active:cursor-grabbing"
          {...(props.mode === 'auto' ? props.dragHandleProps : {})}
          aria-label={props.mode === 'auto' ? t('logicalModels.row.dragAria', { model: model.modelName }) : undefined}
        >
          {props.mode === 'manual' ? (
            props.selected ? <CircleDot size={16} className="text-primary" /> : <Circle size={16} className="text-text-quaternary" />
          ) : (
            <GripVertical size={16} />
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 system-xs-medium">
            {props.provider && props.onNavigateToProviderAnalytics ? (
              <button
                type="button"
                className="group/provider inline-flex min-w-0 items-center gap-0.5 rounded-sm text-left text-text-primary outline-none transition-colors hover:text-primary focus-visible:bg-accent focus-visible:text-primary"
                title={t('logicalModels.row.viewAnalytics', { provider: props.provider.name })}
                aria-label={t('logicalModels.row.viewAnalytics', { provider: props.provider.name })}
                onClick={event => {
                  event.stopPropagation()
                  props.onNavigateToProviderAnalytics?.(model.providerId)
                }}
              >
                <span className="min-w-0 truncate">{props.provider.name}</span>
                <span className="shrink-0 text-text-quaternary" aria-hidden="true">·</span>
                <span className="min-w-0 truncate font-mono text-text-primary">{model.modelName}</span>
                <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-text-quaternary transition-transform group-hover/provider:translate-x-0.5 group-hover/provider:text-primary group-focus-visible/provider:text-primary" />
              </button>
            ) : (
              <>
                <div className="min-w-0 truncate text-text-primary">{props.provider?.name ?? t('logicalModels.row.unknownProvider')}</div>
                <span className="shrink-0 text-text-quaternary" aria-hidden="true">·</span>
                <div className="min-w-0 truncate font-mono text-text-primary">{model.modelName}</div>
              </>
            )}
          </div>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 system-2xs-regular text-text-tertiary">
          <ProtocolIcons endpoints={model.endpoints} />
          <span className="shrink-0 text-text-quaternary" aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1"><Zap size={10} aria-hidden />TPS {formatAverageTps(props.metrics?.avgTps)}</span>
          <span className="inline-flex items-center gap-1"><Timer size={10} aria-hidden />TTFT {formatAverageTtft(props.metrics?.avgTtftMilliseconds)}</span>
          <ModelHealth providerHealth={props.providerHealth} providerModelHealth={props.providerModelHealth} />
        </div>
      </div>
      <div className="relative flex min-w-20 items-center justify-end">
        <Badge variant={props.cooling ? 'destructive' : model.enabled ? 'success' : 'muted'}>{props.cooling ? t('logicalModels.row.cooling') : model.enabled ? (props.selected ? t('logicalModels.row.selected') : t('logicalModels.row.standby')) : t('common.state.disabled')}</Badge>
        <div className="absolute top-1/2 right-0 flex -translate-y-1/2 translate-x-3 items-center gap-1 rounded-md border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-1.5 py-0.5 backdrop-blur-[5px] opacity-0 transition-all group-hover/row:translate-x-0 group-hover/row:opacity-100 focus-within:translate-x-0 focus-within:opacity-100">
          <Switch checked={model.enabled} onCheckedChange={props.onToggleEnabled} onClick={event => event.stopPropagation()} aria-label={t('logicalModels.row.enabledState', { model: model.modelName })} />
          <Button variant="ghost" size="icon-sm" onClick={event => { event.stopPropagation(); props.onRemove() }} aria-label={t('logicalModels.row.removeAria', { model: model.modelName })} title={t('logicalModels.row.removeTitle')}><Trash2 size={16} /></Button>
        </div>
      </div>
    </div>
  )
}
