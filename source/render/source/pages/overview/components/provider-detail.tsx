import { BarChart3, CheckCircle2, Clock3, Coins, TriangleAlert } from 'lucide-react'
import type { AnalyticsRange, ProviderAnalyticsDetail } from '@common/schemas'
import { Card, CardContent } from '@/components/ui/card'
import { CardSectionHeader } from '@/components/card-section-header'
import { MetricGrid } from '@/components/metric-grid'
import { Badge } from '@/components/ui/badge'
import { formatLatency, formatTokens } from '../lib/format'
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

  return (
    <div className="grid gap-4">
      <MetricGrid className="sm:grid-cols-5" items={[
        { label: '尝试数', value: summary.attempts.toLocaleString(), Icon: BarChart3 },
        { label: '尝试成功率', value: `${(summary.successRate * 100).toFixed(1)}%`, Icon: CheckCircle2 },
        { label: '失败尝试', value: summary.failed.toLocaleString(), Icon: TriangleAlert },
        { label: '平均延迟', value: hasSuccessfulCalls ? formatLatency(summary.avgLatencyMs) : '—', Icon: Clock3 },
        { label: '用量', value: formatTokens(summary.totalTokens), Icon: Coins },
      ]} />

      <Card>
        <CardSectionHeader title="模型表现" description="按调用量排序 · 用于定位具体模型的质量与缓存差异" compact />
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] system-xs-regular">
              <thead className="bg-inset text-text-tertiary"><tr><th className="px-4 py-2 text-left system-2xs-medium">模型</th><th className="px-3 py-2 text-right system-2xs-medium">尝试数</th><th className="px-3 py-2 text-right system-2xs-medium">平均延迟</th><th className="px-3 py-2 text-right system-2xs-medium">平均 TTFT</th><th className="px-3 py-2 text-right system-2xs-medium">平均 TPS</th><th className="px-3 py-2 text-right system-2xs-medium">缓存命中率</th><th className="px-4 py-2 text-right system-2xs-medium">成功率</th></tr></thead>
              <tbody>{providerModels.length === 0 ? <tr><td colSpan={7} className="py-8 text-center text-text-tertiary">暂无模型数据</td></tr> : providerModels.map(model => (
                <tr key={model.providerModelId} className="border-t border-border/40 transition-colors hover:bg-state-base-hover">
                  <td className="max-w-52 truncate px-4 py-2.5 system-xs-medium text-text-primary">{model.providerModelName}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{model.attempts.toLocaleString()}</td>
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
