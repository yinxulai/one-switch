import { useEffect, useState } from 'react'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import { requestRewriteRuleApi, providerModelApi } from '@/api/models'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { ProtocolIcons } from '@/components/protocol-icons'
import { SortableProviderModel } from './sortable-provider-model'
import type { ProviderModelRoute } from '@common/schemas'

interface ProviderModelRowProps {
  provider: Provider
  model: ProviderModelRoute
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  onEditModel: (model: ProviderModelRoute) => void
  onToggleModelEnabled: (model: ProviderModelRoute, enabled: boolean) => void
  onRemoveModel: (model: ProviderModelRoute) => void
}

export function ProviderModelRow(props: ProviderModelRowProps) {
  const { provider, model, selected, onSelectedChange, onEditModel, onToggleModelEnabled, onRemoveModel } = props
  const [ruleNames, setRuleNames] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void Promise.all([requestRewriteRuleApi.list(), providerModelApi.requestRewriteRules(model.id)])
      .then(([allResponse, bindingsResponse]) => {
        if (cancelled || !allResponse.success || !bindingsResponse.success) return
        const allRules = allResponse.data
        const names = bindingsResponse.data
          .map(binding => allRules.find(rule => rule.id === binding.ruleId)?.name)
          .filter((name): name is string => Boolean(name))
        setRuleNames(names)
      })
    return () => { cancelled = true }
  }, [model.id])

  return (
    <SortableProviderModel id={model.id}>
      {(handleProps, dragging) => (
        <div className={'px-3 py-2.5 ' + (dragging ? 'bg-muted/60' : '')}>
          <div className="flex items-center gap-2">
          <button
            aria-label={`拖动 ${model.modelName}`}
            className="cursor-grab touch-none text-muted-foreground/50"
            {...handleProps}
          >
            <GripVertical size={14} />
          </button>
          <Checkbox
            checked={selected}
            onCheckedChange={value => onSelectedChange(value === true)}
            aria-label={`选择模型 ${model.modelName}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-medium">{model.modelName}</span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <ProtocolIcons endpoints={model.endpoints} />
              {ruleNames.length > 0 && <>
                <span className="text-muted-foreground/70">·</span>
                {ruleNames.map(name => <Badge key={name} variant="muted" className="max-w-40 truncate px-1.5 py-0 text-[10px] font-normal">{name}</Badge>)}
              </>}
            </div>
          </div>
          <Switch
            checked={model.enabled}
            onCheckedChange={enabled => onToggleModelEnabled(model, enabled)}
            aria-label={`${model.modelName} 启用状态`}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            title="编辑模型"
            onClick={() => onEditModel(model)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive"
            title="删除模型"
            onClick={() => onRemoveModel(model)}
          >
            <Trash2 size={13} />
          </Button>
          </div>
        </div>
      )}
    </SortableProviderModel>
  )
}
