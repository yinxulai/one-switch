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

interface BoundRule { id: string; name: string; stages: Array<'request' | 'response'>; enabled: boolean; global: boolean }

interface ProviderRuleBindingsProps {
  providerModelId: string
  embedded?: boolean
}

export function ProviderRuleBindings(props: ProviderRuleBindingsProps) {
  const { providerModelId, embedded = false } = props
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
            : '未知错误'
        setLoadError(message)
        setLoading(false)
        toast.error(`请求重写加载失败：${message}`)
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
      const message = error instanceof Error ? error.message : '未知错误'
      setLoadError(message)
      setLoading(false)
      toast.error(`请求重写加载失败：${message}`)
    })
    return () => { cancelled = true }
  }, [providerModelId, toast])
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
            <h3 className="system-sm-medium text-text-primary">请求重写</h3>
            <Badge variant="muted" className="font-normal">{rules.length} 条（含全局）</Badge>
          </div>
          <p className="mt-0.5 system-xs-regular text-text-tertiary">
            全局请求重写会自动生效且不可编辑；普通请求重写可在此绑定并调整顺序。
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setAddDialogOpen(true)} disabled={loading || Boolean(loadError) || availableRules.length === 0}>
          <Plus /> 添加规则
        </Button>
      </div>

      <Dialog open={addDialogOpen} onOpenChange={open => { setAddDialogOpen(open); if (!open) { setSelectedRuleIds([]); setRuleSearch('') } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>添加请求重写规则</DialogTitle>
            <DialogDescription>选择需要绑定到当前模型的普通规则，可一次添加多条。</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute top-2.5 left-3 size-3.5 text-text-tertiary" aria-hidden />
            <Input value={ruleSearch} onChange={event => setRuleSearch(event.target.value)} placeholder="搜索规则名称或描述" className="pl-9" />
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {filteredRules.length > 0 ? filteredRules.map(rule => {
              const checked = selectedRuleIds.includes(rule.id)
              return <label key={rule.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-module-border bg-workflow-block-parma-bg px-3 py-2.5 hover:bg-state-base-hover-alt">
                <Checkbox checked={checked} onCheckedChange={value => setSelectedRuleIds(ids => value ? [...ids, rule.id] : ids.filter(id => id !== rule.id))} />
                <span className="min-w-0 flex-1"><span className="block truncate system-xs-medium text-text-primary">{rule.name}</span><span className="mt-0.5 block truncate system-2xs-regular text-text-tertiary">{rule.description || '无描述'}</span></span>
                <span className="flex shrink-0 gap-1">{[...new Set(rule.actions.map(action => action.stage))].map(stage => <Badge key={stage} variant={stage === 'request' ? 'secondary' : 'warning'} className="font-normal">{stage === 'request' ? '请求' : '响应'}</Badge>)}</span>
              </label>
            }) : <p className="py-8 text-center system-xs-regular text-text-tertiary">没有匹配的可添加规则</p>}
          </div>
          <DialogFooter>
            <span className="mr-auto system-xs-regular text-text-tertiary">已选择 {selectedRuleIds.length} 条</span>
            <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>取消</Button>
            <Button type="button" onClick={addRules} disabled={selectedRuleIds.length === 0}>添加所选规则</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {rules.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-module-border bg-workflow-block-parma-bg">
          {rules.map((rule, index) => (
            <div key={rule.id} className="flex items-center gap-2 px-3 py-2.5 not-last:border-b not-last:border-border/40">
              <button type="button" aria-label={`调整 ${rule.name} 顺序`} className="cursor-grab text-text-quaternary">
                <GripVertical className="size-3.5" />
              </button>
              <span className="flex size-5 items-center justify-center rounded-md bg-card system-2xs-medium text-text-tertiary">{index + 1}</span>
              <ScrollText className="size-3.5 text-text-tertiary" aria-hidden />
              <span className="min-w-0 flex-1 truncate system-xs-medium text-text-primary">{rule.name}</span>
              {rule.stages.map(stage => <Badge key={stage} variant={stage === 'request' ? 'secondary' : 'warning'} className="font-normal">{stage === 'request' ? '请求' : '响应'}</Badge>)}
              {rule.global ? <Badge variant="muted" className="font-normal">全局{!rule.enabled && ' · 停用'}</Badge> : <>
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={enabled => persist(rules.map(item => item.id === rule.id ? { ...item, enabled } : item))}
                  aria-label={`${rule.name}绑定状态`}
                />
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => persist(rules.filter(item => item.id !== rule.id))} aria-label={`移除 ${rule.name}`} className="text-text-tertiary hover:text-text-destructive">
                  <Trash2 />
                </Button>
              </>}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-module-border bg-workflow-block-parma-bg px-4 py-6 text-center">
          <p className="system-xs-medium text-text-primary">未添加普通规则</p>
          <p className="mt-1 system-2xs-regular text-text-tertiary">
            {loadError ? '规则加载失败，请稍后重试。' : availableRules.length === 0 && !loading ? '请先在“请求重写”页面创建并保存普通规则。' : '当前模型会自动应用已启用的全局请求重写。'}
          </p>
        </div>
      )}
    </section>
  )
}
