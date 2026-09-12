import { Filter, Search, SearchX, SlidersHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { InlineEmptyState } from '@/components/inline-empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import type { RequestRewriteRule, RuleStatusFilter } from '../types'

interface RuleLibraryProps {
  rules: RequestRewriteRule[]
  selectedRuleId: string
  search: string
  statusFilter: RuleStatusFilter
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: RuleStatusFilter) => void
  onSelect: (id: string) => void
}

export function RuleLibrary(props: RuleLibraryProps) {
  const t = useTranslation()
  return (
    <Card className="h-fit overflow-hidden">
        <CardHeader className="grid gap-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t('rules.library.title')}</CardTitle>
          <Badge variant="muted" className="font-normal">{t('rules.library.count', { count: props.rules.length })}</Badge>
        </div>
        <div className="grid gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary" />
            <Input
              value={props.search}
              onChange={event => props.onSearchChange(event.target.value)}
              placeholder={t('rules.library.searchPlaceholder')}
              className="pl-9"
              aria-label={t('rules.library.searchAria')}
            />
          </div>
          <Select value={props.statusFilter} onValueChange={value => props.onStatusFilterChange(value as RuleStatusFilter)}>
            <SelectTrigger aria-label={t('rules.filter.statusAria')} className="w-full">
              <span className="flex items-center gap-2">
                <Filter className="size-3.5 text-text-tertiary" />
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('rules.filter.statusAll')}</SelectItem>
              <SelectItem value="enabled">{t('rules.filter.statusEnabled')}</SelectItem>
              <SelectItem value="disabled">{t('rules.filter.statusDisabled')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {props.rules.length > 0 ? (
          <div className="grid gap-0.5 px-2 pb-2">
            {props.rules.map(rule => {
              const active = props.selectedRuleId === rule.id
              const hasRequest = rule.actions.some(action => action.stage === 'request')
              const hasResponse = rule.actions.some(action => action.stage === 'response')
              return (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => props.onSelect(rule.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-lg px-2.5 py-2.5 text-left transition-colors',
                    active ? 'bg-accent text-text-primary' : 'hover:bg-state-base-hover',
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg',
                      hasRequest ? 'bg-info/15 text-info' : 'bg-warning/15 text-text-warning',
                    )}>
                      <SlidersHorizontal className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate system-xs-medium">{rule.name}</span>
                        {!rule.enabled && <Badge variant="muted" className="px-1.5 py-0 system-2xs-medium">{t('rules.status.disabled')}</Badge>}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 system-2xs-regular text-text-tertiary">
                        <span>{[hasRequest && t('rules.stage.request'), hasResponse && t('rules.stage.response')].filter(Boolean).join(' / ')}</span>
                        <span>·</span>
                        <span>{t('rules.library.actionCount', { count: rule.actions.length })}</span>
                        <span>·</span>
                        <span>{rule.global ? t('rules.scope.global') : t('rules.boundProviders', { count: rule.boundProviders })}</span>
                      </span>
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <InlineEmptyState icon={SearchX} title={t('rules.filter.empty.title')} description={t('rules.filter.empty.description')} />
        )}
      </CardContent>
    </Card>
  )
}
