import { useEffect, useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import { providerApi } from '@/api/providers'
import { providerModelApi, schedulingPolicyApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'

type ProviderModelOption = { id: string; providerId: string; providerName: string; modelName: string }

interface AddQueueModelDialogProps {
  open: boolean
  logicalModelId: string
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}

export function AddQueueModelDialog(props: AddQueueModelDialogProps) {
  const { open, logicalModelId, onOpenChange, onAdded } = props
  const toast = useToast()
  const [models, setModels] = useState<ProviderModelOption[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const modelGroups = useMemo(() => {
    const groups = new Map<string, ProviderModelOption[]>()
    for (const model of models) {
      const group = groups.get(model.providerName) ?? []
      group.push(model)
      groups.set(model.providerName, group)
    }
    return [...groups.entries()]
  }, [models])

  const selectedModels = models.filter(model => selectedIds.includes(model.id))
  const filteredModelGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return modelGroups
    return modelGroups
      .map(([providerName, providerModels]) => [providerName, providerModels.filter(model => `${providerName} ${model.modelName} ${model.id}`.toLowerCase().includes(query))] as const)
      .filter(([, providerModels]) => providerModels.length > 0)
  }, [modelGroups, search])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void Promise.all([unwrap(providerApi.list()), unwrap(providerModelApi.list()), unwrap(schedulingPolicyApi.list(logicalModelId))])
      .then(([providersResult, modelsResult, policiesResult]) => {
        if (cancelled) return
        const providerNameById = new Map(providersResult.map(provider => [provider.id, provider.name]))
        const policies = new Set(policiesResult.map(policy => policy.providerModelId))
        setModels(modelsResult
          .filter(model => model.deletedTime === null && !policies.has(model.id))
          .map(model => ({ id: model.id, providerId: model.providerId, providerName: providerNameById.get(model.providerId) ?? model.providerId, modelName: model.modelName })))
        setSelectedIds([])
        setSearch('')
      })
      .catch(error => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [logicalModelId, open, toast])

  const addModels = async () => {
    if (selectedIds.length === 0) return
    setSaving(true)
    try {
      await Promise.all(selectedIds.map((providerModelId, index) => unwrap(schedulingPolicyApi.update({ logicalModelId, providerModelId, priority: models.length + index + 1, enabled: true }))))
      toast.success(`已添加 ${selectedIds.length} 个模型到队列，并创建调度配置`)
      onAdded()
      onOpenChange(false)
      setSelectedIds([])
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加模型到队列</DialogTitle>
          <DialogDescription>添加模型会为当前队列创建一条调度配置；未显式添加的模型不会参与请求。</DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm text-muted-foreground">正在加载可添加模型…</p> : models.length === 0 ? <p className="text-sm text-muted-foreground">没有可添加的供应商模型，请先在模型管理中创建模型。</p> : (
          <div className="flex min-h-0 flex-col gap-2">
            <Command shouldFilter={false} className="min-h-0 rounded-lg bg-muted/20 p-0">
              <CommandInput className="px-2" placeholder="搜索模型或供应商…" value={search} onValueChange={setSearch} />
              <CommandList className="max-h-64 px-1 pb-1">
                <CommandEmpty>没有匹配的模型。</CommandEmpty>
                {filteredModelGroups.map(([providerName, providerModels]) => (
                  <CommandGroup key={providerName} heading={providerName} className="p-1">
                    {providerModels.map(model => (
                      <CommandItem key={model.id} value={model.id} className="min-h-9" onSelect={() => setSelectedIds(current => current.includes(model.id) ? current.filter(id => id !== model.id) : [...current, model.id])}>
                        <span className="min-w-0 flex-1 truncate">{model.modelName}</span>
                        <Check className={`size-4 shrink-0 ${selectedIds.includes(model.id) ? 'opacity-100' : 'opacity-0'}`} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
            <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-md bg-muted/30 px-2 py-1.5">
              {selectedModels.length === 0 ? <span className="text-xs text-muted-foreground">请选择一个或多个模型</span> : selectedModels.map(model => (
                <button key={model.id} type="button" className="inline-flex max-w-full items-center gap-1 rounded-md bg-background px-2 py-1 text-xs" onClick={() => setSelectedIds(current => current.filter(id => id !== model.id))}>
                  <span className="max-w-48 truncate">{model.modelName}</span>
                  <X className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={selectedIds.length === 0 || saving || loading} onClick={() => void addModels()}>{saving ? '添加中…' : `添加到队列${selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
