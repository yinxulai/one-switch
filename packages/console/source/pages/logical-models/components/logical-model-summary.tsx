import { Activity, Clock3, Layers3, Zap } from 'lucide-react'
import { MetricGrid } from '@/components/metric-grid'
import { NumberTicker } from '@/components/ui/number-ticker'
import { useTranslation } from '@/i18n/provider'
import type { LogicalModelProviderModel } from '@common/schemas'
import { millisecondsDisplayParts, outputSpeedDecimalPlaces } from '@common/metrics'
import type { LogicalModelSummaryMetrics } from '../lib/model-metrics'

interface LogicalModelSummaryProps {
  models: LogicalModelProviderModel[]
  summaryMetrics?: LogicalModelSummaryMetrics
}

type TickerValueProps = {
  value: number | null | undefined
  decimalPlaces?: number
  suffix?: string
}

interface DurationTickerProps {
  milliseconds: number
}

function TickerValue(props: TickerValueProps) {
  if (props.value == null) return <>—</>
  return <><NumberTicker value={props.value} decimalPlaces={props.decimalPlaces} />{props.suffix}</>
}

/** 延迟的动画展示。数值、单位与小数位都由 `@common/metrics` 的同一套规则给出。 */
function DurationTicker(props: DurationTickerProps) {
  const parts = millisecondsDisplayParts(props.milliseconds)
  return <TickerValue value={parts.value} decimalPlaces={parts.decimalPlaces} suffix={parts.unit} />
}

export function LogicalModelSummary(props: LogicalModelSummaryProps) {
  const t = useTranslation()
  const enabledCount = props.models.filter(model => model.enabled).length
  const metrics = props.summaryMetrics

  return (
    // 指标卡只有「标签 + 数值」两行：口径说明压在标签旁的 info 图标里（悬停 / 聚焦才出现），
    // 不在数字下面铺第三行小字——那一行把「看一个数」变成「读一句话」，
    // 而且只有算得复杂的指标才写得出来，四张卡摆在一起就是两行与三行参差。
    <MetricGrid items={[
      { label: t('logicalModels.summary.successRate'), value: metrics?.successRate == null ? '—' : <><TickerValue value={metrics.successRate * 100} decimalPlaces={1} suffix="%" /></>, Icon: Activity, info: metrics ? t('logicalModels.summary.successRateHint', { count: metrics.completedRequestCount }) : t('logicalModels.summary.awaitingData') },
      { label: t('logicalModels.summary.avgDuration'), value: metrics?.avgDurationMilliseconds == null ? '—' : <DurationTicker milliseconds={metrics.avgDurationMilliseconds} />, Icon: Clock3, info: t('logicalModels.summary.avgDurationHint') },
      { label: t('logicalModels.summary.avgTps'), value: metrics?.avgTps == null ? '—' : <TickerValue value={metrics.avgTps} decimalPlaces={outputSpeedDecimalPlaces(metrics.avgTps)} />, Icon: Zap, info: t('logicalModels.summary.avgTpsHint') },
      { label: t('logicalModels.summary.availableModels'), value: <><TickerValue value={enabledCount} /> / <TickerValue value={props.models.length} /></>, Icon: Layers3, info: metrics?.failoverCount ? t('logicalModels.summary.failoverHint', { count: metrics.failoverCount }) : t('logicalModels.summary.noFailover') },
    ]} />
  )
}
