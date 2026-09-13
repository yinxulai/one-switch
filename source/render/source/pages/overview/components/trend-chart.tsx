import type { AnalyticsRange, DailyTrendPoint } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { CardSectionHeader } from '@/components/card-section-header'
import { useLocale, useTranslation, type AppTranslator } from '@/i18n/provider'
import { formatTokens, formatTrendDescription } from '../lib/format'

function buildChartConfig(t: AppTranslator): ChartConfig {
  return {
    inputTokens: { label: t('overview.trend.input'), color: 'hsl(var(--success))' },
    outputTokens: { label: t('overview.trend.output'), color: '#0891b2' },
    reasoningTokens: { label: t('overview.trend.reasoning'), color: '#64748b' },
    cachedInputTokens: { label: t('overview.trend.cacheRead'), color: '#14b8a6' },
    cacheCreationInputTokens: { label: t('overview.trend.cacheWrite'), color: '#f59e0b' },
  }
}

interface TrendChartProps {
  trend: DailyTrendPoint[]
  range: AnalyticsRange
  stretchToRow?: boolean
}

// X 轴刻度只控制标签密度，不影响 15 分钟粒度的数据和 Tooltip；
// 今日每 2 小时显示一个标签，近 7 天全部显示，近 30 天每 5 天显示一个。
function axisInterval(range: AnalyticsRange): number {
  if (range === 'today') return 7
  if (range === '7d') return 0
  return 4
}

function formatAxisTick(locale: string, label: string, range: AnalyticsRange): string {
  if (range === 'today') return label
  const date = new Date(label)
  if (range === '7d') return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(date)
}

function formatTooltipLabel(locale: string, label: string, range: AnalyticsRange): string {
  if (range === 'today') return label
  const date = new Date(label)
  const day = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(date)
  if (range !== '7d') return day
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
  return `${day} ${weekday}`
}

interface TrendTooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ payload?: DailyTrendPoint }>
  range: AnalyticsRange
}

// Tooltip 按阅读顺序展示；柱状图按从底到顶反向排列，使输入位于最上层。
const USAGE_ITEMS = [
  ['inputTokens', 'overview.trend.input'],
  ['cachedInputTokens', 'overview.trend.cacheRead'],
  ['cacheCreationInputTokens', 'overview.trend.cacheWrite'],
  ['outputTokens', 'overview.trend.output'],
  ['reasoningTokens', 'overview.trend.reasoning'],
] as const satisfies ReadonlyArray<readonly [keyof DailyTrendPoint, UiCatalogKey]>

const STACK_ITEMS = [...USAGE_ITEMS].reverse()

function TrendTooltip(props: TrendTooltipProps) {
  const { active, label, payload, range } = props
  const t = useTranslation()
  const locale = useLocale()
  if (!active || !label || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  return (
    <div className="rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur px-3 py-2 system-xs-regular backdrop-blur-[5px]">
      <div className="system-xs-medium text-text-primary">{formatTooltipLabel(locale, label, range)}</div>
      <div className="mt-1.5 grid gap-1">
        {USAGE_ITEMS.map(([key, labelKey]) => (
          <div key={key} className="flex items-center justify-between gap-6">
            <span className="text-text-tertiary">{t(labelKey)}</span>
            <span className="font-mono system-xs-medium tabular-nums text-text-primary">{formatTokens(point[key])}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TrendChart(props: TrendChartProps) {
  const { trend, range, stretchToRow = false } = props
  const t = useTranslation()
  const locale = useLocale()
  const contentClassName = stretchToRow
    ? 'flex min-h-0 min-w-0 flex-1 flex-col'
    : 'min-w-0'
  const chartClassName = stretchToRow
    ? 'aspect-auto min-h-44 w-full flex-1'
    : 'aspect-auto h-44 w-full'

  return (
    <Card className="min-w-0 w-full">
      <CardSectionHeader title={t('overview.trend.title')} description={formatTrendDescription(t, range)} compact />
      <CardContent className={contentClassName}>
        {trend.length === 0 ? (
          <div className={`${stretchToRow ? 'flex-1 ' : ''}flex min-h-44 items-center justify-center system-xs-regular text-text-tertiary`}>
            {t('overview.trend.empty')}
          </div>
        ) : (
          <ChartContainer config={buildChartConfig(t)} className={chartClassName}>
            <BarChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval={axisInterval(range)}
                tickFormatter={value => formatAxisTick(locale, String(value), range)}
                fontSize={11}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={40}
                allowDecimals={false}
                tickFormatter={value => formatTokens(Number(value))}
                fontSize={11}
              />
              <Tooltip content={<TrendTooltip range={range} />} />
              {STACK_ITEMS.map(([key], index) => (
                <Bar key={key} dataKey={key} stackId="usage" fill={`var(--color-${key})`} radius={index === STACK_ITEMS.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
