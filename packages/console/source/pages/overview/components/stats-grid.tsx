import { BarChart3, CheckCircle2, Zap, Coins } from 'lucide-react'
import type { StatsSummary } from '@common/schemas'
import { MetricGrid } from '@/components/metric-grid'
import { NumberTicker } from '@/components/ui/number-ticker'
import { useTranslation } from '@/i18n/provider'

interface StatsGridProps {
  summary: StatsSummary
}

export function StatsGrid(props: StatsGridProps) {
  const { summary } = props
  const t = useTranslation()

  return (
    <MetricGrid items={[
      { label: t('overview.stats.totalRequests'), value: <NumberTicker value={summary.totalRequests} />, Icon: BarChart3 },
      { label: t('overview.stats.successRate'), value: <><NumberTicker value={summary.successRate * 100} decimalPlaces={1} />%</>, Icon: CheckCircle2 },
      { label: t('overview.stats.avgLatency'), value: summary.avgLatencyMs < 1000 ? <><NumberTicker value={summary.avgLatencyMs} />ms</> : <><NumberTicker value={summary.avgLatencyMs / 1000} decimalPlaces={1} />s</>, Icon: Zap },
      { label: t('overview.stats.tokenUsage'), value: summary.totalTokens >= 1_000_000 ? <><NumberTicker value={summary.totalTokens / 1_000_000} decimalPlaces={1} />M</> : summary.totalTokens >= 1_000 ? <><NumberTicker value={summary.totalTokens / 1_000} decimalPlaces={1} />K</> : <NumberTicker value={summary.totalTokens} />, Icon: Coins },
    ]} />
  )
}
