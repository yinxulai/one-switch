import { Filter, Search, SearchX, SlidersHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { InlineEmptyState } from '@/components/inline-empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
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
  return (
    <Card className="h-fit overflow-hidden">
        <CardHeader className="grid gap-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>规则库</CardTitle>
          <Badge variant="muted" className="font-normal">{props.rules.length} 条</Badge>
        </div>
        <div className="grid gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary" />
            <Input
              value={props.search}
              onChange={event => props.onSearchChange(event.target.value)}
              placeholder="搜索名称或动作"
              className="pl-9"
              aria-label="搜索请求重写规则"
            />
          </div>
          <Select value={props.statusFilter} onValueChange={value => props.onStatusFilterChange(value as RuleStatusFilter)}>
            <SelectTrigger aria-label="筛选规则状态" className="w-full">
              <span className="flex items-center gap-2">
                <Filter className="size-3.5 text-text-tertiary" />
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="enabled">仅启用</SelectItem>
              <SelectItem value="disabled">仅停用</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {props.rules.length > 0 ? (
          <div className="grid gap-0.5 px-2 pb-2">
            {props.rules.map(rule => {
              const active = props.selectedRuleId === rule.id
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
                      rule.actions.some(action => action.stage === 'request') ? 'bg-info/15 text-info' : 'bg-warning/15 text-text-warning',
                    )}>
                      <SlidersHorizontal className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate system-xs-medium">{rule.name}</span>
                        {!rule.enabled && <Badge variant="muted" className="px-1.5 py-0 system-2xs-medium">停用</Badge>}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 system-2xs-regular text-text-tertiary">
                        <span>{rule.actions.some(action => action.stage === 'request') ? '请求' : ''}{rule.actions.some(action => action.stage === 'request') && rule.actions.some(action => action.stage === 'response') ? ' / ' : ''}{rule.actions.some(action => action.stage === 'response') ? '响应' : ''}</span>
                        <span>·</span>
                        <span>{rule.actions.length} 个动作</span>
                        <span>·</span>
                        <span>{rule.global ? '全局' : `${rule.boundProviders} 个供应商`}</span>
                      </span>
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <InlineEmptyState icon={SearchX} title="没有匹配的规则" description="试着放宽搜索词，或把状态筛选切回全部状态。" />
        )}
      </CardContent>
    </Card>
  )
}
