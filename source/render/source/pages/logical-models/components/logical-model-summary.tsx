import { Activity, Clock3, Layers3, Zap } from 'lucide-react'
import { MetricGrid } from '@/components/metric-grid'
import { NumberTicker } from '@/components/ui/number-ticker'
import { useTranslation } from '@/i18n/provider'
import type { ProviderModelRoute } from '@common/schemas'
import type { LogicalModelSummaryMetrics } from '../lib/model-metrics'

interface LogicalModelSummaryProps {
  models: ProviderModelRoute[]
  summaryMetrics?: LogicalModelSummaryMetrics
}

type TickerValueProps = {
  value: number | null | undefined
  decimalPlaces?: number
  suffix?: string
}

function TickerValue(props: TickerValueProps) {
  if (props.value == null) return <>—</>
  return <><NumberTicker value={props.value} decimalPlaces={props.decimalPlaces} />{props.suffix}</>
}

export function LogicalModelSummary(props: LogicalModelSummaryProps) {
  const t = useTranslation()
  const enabledCount = props.models.filter(model => model.enabled).length
  const metrics = props.summaryMetrics

  return (
    <MetricGrid items={[
      { label: t('logicalModels.summary.successRate'), value: metrics?.successRate == null ? '—' : <><TickerValue value={metrics.successRate * 100} decimalPlaces={1} suffix="%" /></>, Icon: Activity, hint: metrics ? <>{t('logicalModels.summary.successRateHint', { count: metrics.completedRequestCount })}</> : t('logicalModels.summary.awaitingData') },
      { label: t('logicalModels.summary.avgDuration'), value: metrics?.avgDurationMilliseconds == null ? '—' : <><TickerValue value={metrics.avgDurationMilliseconds >= 1000 ? metrics.avgDurationMilliseconds / 1000 : metrics.avgDurationMilliseconds} decimalPlaces={metrics.avgDurationMilliseconds >= 1000 ? 1 : 0} suffix={metrics.avgDurationMilliseconds >= 1000 ? 's' : 'ms'} /></>, Icon: Clock3, hint: t('logicalModels.summary.avgDurationHint') },
      { label: t('logicalModels.summary.avgTps'), value: metrics?.avgTps == null ? '—' : <TickerValue value={metrics.avgTps} decimalPlaces={metrics.avgTps >= 10 ? 0 : 1} />, Icon: Zap, hint: t('logicalModels.summary.avgTpsHint') },
      { label: t('logicalModels.summary.availableModels'), value: <><TickerValue value={enabledCount} /> / <TickerValue value={props.models.length} /></>, Icon: Layers3, hint: metrics?.failoverCount ? <>{t('logicalModels.summary.failoverHint', { count: metrics.failoverCount })}</> : t('logicalModels.summary.noFailover') },
    ]} />
  )
}
