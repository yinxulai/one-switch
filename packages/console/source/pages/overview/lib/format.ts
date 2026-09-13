import type { AnalyticsRange } from '@common/schemas'
import type { AppTranslator } from '@/i18n/provider'

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
}

/** 千分位分隔必须跟随界面语言，不能用运行时默认语言。 */
export function formatCount(locale: string, value: number): string {
  return value.toLocaleString(locale)
}

export function formatTrendDescription(t: AppTranslator, range: AnalyticsRange): string {
  return range === 'today' ? t('overview.trend.description.today') : t('overview.trend.description.daily')
}

export const PROVIDER_COLORS = [
  'bg-emerald-500',
  'bg-orange-500',
  'bg-indigo-500',
  'bg-zinc-700',
  'bg-rose-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-teal-500',
]

export function getProviderColor(index: number): string {
  return PROVIDER_COLORS[index % PROVIDER_COLORS.length]
}
