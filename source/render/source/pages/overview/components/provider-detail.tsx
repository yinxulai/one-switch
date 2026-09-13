import { BarChart3, CheckCircle2, Clock3, Coins, TriangleAlert } from 'lucide-react'
import type { AnalyticsRange, ProviderAnalyticsDetail } from '@common/schemas'
import { Card, CardContent } from '@/components/ui/card'
import { CardSectionHeader } from '@/components/card-section-header'
import { MetricGrid } from '@/components/metric-grid'
import { Badge } from '@/components/ui/badge'
import { useLocale, useTranslation } from '@/i18n/provider'
import { formatCount, formatLatency, formatTokens } from '../lib/format'
import { FailureReasons } from './failure-reasons'
import { LatencyDistribution } from './latency-distribution'
import { TrendChart } from './trend-chart'

interface ProviderDetailProps {
  detail: ProviderAnalyticsDetail
  range: AnalyticsRange
}

export function ProviderDetail(props: ProviderDetailProps) {
  const { summary, models: providerModels } = props.detail
  const hasSuccessfulCalls = summary.success > 0
  const t = useTranslation()
  const locale = useLocale()

  return (
    <div className="grid gap-4">
      <MetricGrid className="sm:grid-cols-5" items={[
        { label: t('overview.providerDetail.attempts'), value: formatCount(locale, summary.attempts), Icon: BarChart3 },
        { label: t('overview.providerDetail.successRate'), value: `${(summary.successRate * 100).toFixed(1)}%`, Icon: CheckCircle2 },
        { label: t('overview.providerDetail.failed'), value: formatCount(locale, summary.failed), Icon: TriangleAlert },
        { label: t('overview.providerDetail.avgLatency'), value: hasSuccessfulCalls ? formatLatency(summary.avgLatencyMs) : '—', Icon: Clock3 },
        { label: t('overview.providerDetail.usage'), value: formatTokens(summary.totalTokens), Icon: Coins },
      ]} />

      <Card>
        <CardSectionHeader title={t('overview.providerDetail.models.title')} description={t('overview.providerDetail.models.description')} compact />
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] system-xs-regular">
              <thead className="bg-inset text-text-tertiary"><tr><th className="px-4 py-2 text-left system-2xs-medium">{t('overview.models.column.model')}</th><th className="px-3 py-2 text-right system-2xs-medium">{t('overview.providerDetail.attempts')}</th><th className="px-3 py-2 text-right system-2xs-medium">{t('overview.models.column.avgLatency')}</th><th className="px-3 py-2 text-right system-2xs-medium">{t('overview.models.column.avgTtft')}</th><th className="px-3 py-2 text-right system-2xs-medium">{t('overview.models.column.avgTps')}</th><th className="px-3 py-2 text-right system-2xs-medium">{t('overview.models.column.cacheHitRate')}</th><th className="px-4 py-2 text-right system-2xs-medium">{t('overview.models.column.successRate')}</th></tr></thead>
              <tbody>{providerModels.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-text-tertiary">{t('overview.providerDetail.models.empty')}</td></tr> : providerModels.map(model => (
                <tr key={model.providerModelId} className="border-t border-border/40 transition-colors hover:bg-state-base-hover">
                  <td className="max-w-52 truncate px-4 py-2.5 system-xs-medium text-text-primary">{model.providerModelName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{formatCount(locale, model.attempts)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{model.success > 0 ? formatLatency(model.avgLatencyMs) : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{model.avgTtftMs == null ? '—' : formatLatency(model.avgTtftMs)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{model.avgTps == null ? '—' : model.avgTps.toFixed(1)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{model.cacheHitRate == null ? '—' : `${(model.cacheHitRate * 100).toFixed(1)}%`}</td>
                  <td className="px-4 py-2.5 text-right"><Badge variant={model.successRate >= 0.95 ? 'success' : model.successRate >= 0.8 ? 'warning' : 'destructive'} className="h-5 px-1.5 font-mono">{(model.successRate * 100).toFixed(1)}%</Badge></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <TrendChart trend={props.detail.tokenTrend} range={props.range} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LatencyDistribution buckets={props.detail.latencyDistribution} />
        <FailureReasons reasons={props.detail.failureReasons} failedCount={props.detail.failureReasons.reduce((total, reason) => total + reason.count, 0)} />
      </div>
    </div>
  )
}
