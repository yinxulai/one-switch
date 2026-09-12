import { useEffect, useMemo, useState } from 'react'
import { GripVertical, Plus, ScrollText, Search, Trash2 } from 'lucide-react'
import { providerModelApi, requestRewriteRuleApi } from '@/api/models'
import type { RequestRewriteRule } from '@common/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'

interface BoundRule { id: string; name: string; stages: Array<'request' | 'response'>; enabled: boolean; global: boolean }

interface ProviderRuleBindingsProps {
  providerModelId: string
  embedded?: boolean
}

export function ProviderRuleBindings(props: ProviderRuleBindingsProps) {
  const { providerModelId, embedded = false } = props
  const t = useTranslation()
  const toast = useToast()
  const [availableRules, setAvailableRules] = useState<RequestRewriteRule[]>([])
  const [rules, setRules] = useState<BoundRule[]>([])
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([])
  const [ruleSearch, setRuleSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    void Promise.all([requestRewriteRuleApi.list(), providerModelApi.requestRewriteRules(providerModelId)]).then(([allResponse, bindingsResponse]) => {
      if (cancelled) return
      if (!allResponse.success || !bindingsResponse.success) {
        const message = !allResponse.success
          ? allResponse.errorMessage
          : !bindingsResponse.success
            ? bindingsResponse.errorMessage
            : t('common.label.unknownError')
        setLoadError(message)
        setLoading(false)
        toast.error(t('models.rules.loadError', { message }))
        return
      }
      const all = allResponse.data
      const bindings = bindingsResponse.data
      const globalRules = all.filter(rule => rule.scope === 'global')
      setAvailableRules(all.filter(rule => rule.scope !== 'global' && !bindings.some(binding => binding.ruleId === rule.id)))
      setRules([...globalRules.map(rule => ({ id: rule.id, name: rule.name, stages: [...new Set(rule.actions.map(action => action.stage))], enabled: rule.enabled, global: true })), ...bindings.map(binding => { const rule = all.find(item => item.id === binding.ruleId); return rule && rule.scope !== 'global' ? { id: rule.id, name: rule.name, stages: [...new Set(rule.actions.map(action => action.stage))], enabled: binding.enabled && rule.enabled, global: false } : null }).filter((item): item is BoundRule => item !== null)])
      setLoading(false)
    }).catch(error => {
      if (cancelled) return
      const message = error instanceof Error ? error.message : t('common.label.unknownError')
      setLoadError(message)
      setLoading(false)
      toast.error(t('models.rules.loadError', { message }))
    })
    return () => { cancelled = true }
  }, [providerModelId, toast, t])
  const persist = (next: BoundRule[]) => { setRules(next); void providerModelApi.replaceRequestRewriteRules(providerModelId, next.filter(rule => !rule.global).map((rule, priority) => ({ ruleId: rule.id, priority, enabled: rule.enabled }))) }

  const filteredRules = useMemo(() => {
    const keyword = ruleSearch.trim().toLocaleLowerCase()
    return availableRules.filter(rule => !keyword || `${rule.name} ${rule.description}`.toLocaleLowerCase().includes(keyword))
  }, [availableRules, ruleSearch])

  const addRules = () => {
    const selected = availableRules.filter(rule => selectedRuleIds.includes(rule.id))
    if (selected.length === 0) return
    persist([...rules, ...selected.map(rule => ({ id: rule.id, name: rule.name, stages: [...new Set(rule.actions.map(action => action.stage))], enabled: true, global: false }))])
    setSelectedRuleIds([])
    setRuleSearch('')
    setAddDialogOpen(false)
  }

  return (
    <section className={embedded ? 'grid gap-3 pt-1' : 'mt-5 grid gap-3 pt-4'}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="system-sm-medium text-text-primary">{t('models.rules.title')}</h3>
            <Badge variant="muted" className="font-normal">{t('models.rules.count', { count: rules.length })}</Badge>
          </div>
          <p className="mt-0.5 system-xs-regular text-text-tertiary">
            {t('models.rules.description')}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setAddDialogOpen(true)} disabled={loading || Boolean(loadError) || availableRules.length === 0}>
          <Plus /> {t('models.rules.add')}
        </Button>
      </div>

      <Dialog open={addDialogOpen} onOpenChange={open => { setAddDialogOpen(open); if (!open) { setSelectedRuleIds([]); setRuleSearch('') } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('models.rules.addDialogTitle')}</DialogTitle>
            <DialogDescription>{t('models.rules.addDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute top-2.5 left-3 size-3.5 text-text-tertiary" aria-hidden />
            <Input value={ruleSearch} onChange={event => setRuleSearch(event.target.value)} placeholder={t('models.rules.searchPlaceholder')} className="pl-9" />
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {filteredRules.length > 0 ? filteredRules.map(rule => {
              const checked = selectedRuleIds.includes(rule.id)
              return <label key={rule.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-module-border bg-workflow-block-parma-bg px-3 py-2.5 hover:bg-state-base-hover-alt">
                <Checkbox checked={checked} onCheckedChange={value => setSelectedRuleIds(ids => value ? [...ids, rule.id] : ids.filter(id => id !== rule.id))} />
                <span className="min-w-0 flex-1"><span className="block truncate system-xs-medium text-text-primary">{rule.name}</span><span className="mt-0.5 block truncate system-2xs-regular text-text-tertiary">{rule.description || t('rules.table.noDescription')}</span></span>
                <span className="flex shrink-0 gap-1">{[...new Set(rule.actions.map(action => action.stage))].map(stage => <Badge key={stage} variant={stage === 'request' ? 'secondary' : 'warning'} className="font-normal">{stage === 'request' ? t('rules.stage.request') : t('rules.stage.response')}</Badge>)}</span>
              </label>
            }) : <p className="py-8 text-center system-xs-regular text-text-tertiary">{t('models.rules.emptyAddable')}</p>}
          </div>
          <DialogFooter>
            <span className="mr-auto system-xs-regular text-text-tertiary">{t('models.rules.selectedCount', { count: selectedRuleIds.length })}</span>
            <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>{t('common.action.cancel')}</Button>
            <Button type="button" onClick={addRules} disabled={selectedRuleIds.length === 0}>{t('models.rules.confirmAdd')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rules.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-module-border bg-workflow-block-parma-bg">
          {rules.map((rule, index) => (
            <div key={rule.id} className="flex items-center gap-2 px-3 py-2.5 not-last:border-b not-last:border-border/40">
              <button type="button" aria-label={t('models.rules.reorderAria', { name: rule.name })} className="cursor-grab text-text-quaternary">
                <GripVertical className="size-3.5" />
              </button>
              <span className="flex size-5 items-center justify-center rounded-md bg-card system-2xs-medium text-text-tertiary">{index + 1}</span>
              <ScrollText className="size-3.5 text-text-tertiary" aria-hidden />
              <span className="min-w-0 flex-1 truncate system-xs-medium text-text-primary">{rule.name}</span>
              {rule.stages.map(stage => <Badge key={stage} variant={stage === 'request' ? 'secondary' : 'warning'} className="font-normal">{stage === 'request' ? t('rules.stage.request') : t('rules.stage.response')}</Badge>)}
              {rule.global ? <Badge variant="muted" className="font-normal">{t('models.rules.globalBadge')}{!rule.enabled && t('models.rules.globalDisabledSuffix')}</Badge> : <>
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={enabled => persist(rules.map(item => item.id === rule.id ? { ...item, enabled } : item))}
                  aria-label={t('models.rules.toggleAria', { name: rule.name })}
                />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => persist(rules.filter(item => item.id !== rule.id))} aria-label={t('models.rules.removeAria', { name: rule.name })} className="text-text-tertiary hover:text-text-destructive">
                  <Trash2 />
                </Button>
              </>}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-module-border bg-workflow-block-parma-bg px-4 py-6 text-center">
          <p className="system-xs-medium text-text-primary">{t('models.rules.emptyTitle')}</p>
          <p className="mt-1 system-2xs-regular text-text-tertiary">
            {loadError ? t('models.rules.loadFailed') : availableRules.length === 0 && !loading ? t('models.rules.createFirst') : t('models.rules.globalOnly')}
          </p>
        </div>
      )}
    </section>
  )
}
