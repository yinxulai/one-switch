import { ChevronRight } from 'lucide-react'
import type { ProviderStat } from '@common/schemas'
import { cn } from '@/lib/utils'
import { CardSectionHeader } from '@/components/card-section-header'
import { Card, CardContent } from '@/components/ui/card'
import { useLocale, useTranslation } from '@/i18n/provider'
import { formatCount, getProviderColor } from '../lib/format'

interface ProviderDistributionProps {
  stats: ProviderStat[]
  onSelectProvider?: (provider: ProviderStat) => void
}

export function ProviderDistribution(props: ProviderDistributionProps) {
  const { stats } = props
  const t = useTranslation()
  const locale = useLocale()

  return (
    <Card className="min-w-70">
      <CardSectionHeader title={t('overview.providers.title')} description={t('overview.providers.description')} compact />
      <CardContent className="pt-1">
        {stats.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center system-xs-regular text-text-tertiary">
            {t('overview.providers.empty')}
          </div>
        ) : (
          <div className="max-h-72 grid gap-2.5 overflow-y-auto pr-1">
            {stats.map((p, idx) => (
              <button
                key={p.providerId}
                type="button"
                className="group w-full text-left"
                onClick={() => props.onSelectProvider?.(p)}
                disabled={!props.onSelectProvider}
                aria-label={props.onSelectProvider ? t('logicalModels.row.viewAnalytics', { provider: p.providerName }) : undefined}
              >
                <div className="mb-1 flex items-center justify-between gap-2 system-xs-regular">
                  <span className="flex min-w-0 items-center gap-2 system-xs-medium text-text-primary">
                    <span className={cn('size-2 shrink-0 rounded-full', getProviderColor(idx))} />
                    <span className="truncate">{p.providerName}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-text-tertiary tabular-nums">
                    {p.percent}% · {formatCount(locale, p.attempts)}
                    {props.onSelectProvider && <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-inset">
                  <div className={cn('h-full rounded-full', getProviderColor(idx))} style={{ width: `${p.percent}%` }} />
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
