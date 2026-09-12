import { cn } from '@/lib/utils'
import { InlineEmptyState } from '@/components/inline-empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import type { FetchedProviderModel } from '@/api/providers'

interface FetchedModelPickerProps {
  modelId: string
  multiSelect: boolean
  selectedModelIds: string[]
  fetchedModels: FetchedProviderModel[]
  modelSearch: string
  setModelSearch: (search: string) => void
  setModelId: (id: string) => void
  toggleModelSelection: (id: string, checked: boolean) => void
  onSelectAllFiltered: (ids: string[]) => void
  onInvertFiltered: (ids: string[]) => void
  onClearSelection: () => void
  filteredModels: FetchedProviderModel[]
}

export function FetchedModelPicker(props: FetchedModelPickerProps) {
  const {
    modelId,
    multiSelect,
    selectedModelIds,
    fetchedModels,
    modelSearch,
    setModelSearch,
    setModelId,
    toggleModelSelection,
    onSelectAllFiltered,
    onInvertFiltered,
    onClearSelection,
    filteredModels,
  } = props

  if (fetchedModels.length === 0) return null

  return (
    <div className="mt-2 grid gap-2 rounded-lg border border-module-border bg-workflow-block-parma-bg p-1.5">
      <Input
        className="bg-card/70"
        value={modelSearch}
        onChange={event => setModelSearch(event.target.value)}
        placeholder={`搜索 ${fetchedModels.length} 个模型…`}
      />
      {multiSelect && filteredModels.length > 0 && (
        <div className="flex items-center justify-between px-1.5">
          <p className="system-2xs-regular text-text-tertiary">当前筛选 {filteredModels.length} 个模型</p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 system-2xs-medium"
              onClick={() => onSelectAllFiltered(filteredModels.map(model => model.id))}
            >
              全选
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 system-2xs-medium"
              onClick={() => onInvertFiltered(filteredModels.map(model => model.id))}
            >
              反选
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 system-2xs-medium"
              onClick={onClearSelection}
            >
              清空
            </Button>
          </div>
        </div>
      )}
      <div className="max-h-48 overflow-y-auto">
        {filteredModels.length === 0 && (
          <InlineEmptyState title="没有匹配的模型" className="px-2 py-3" />
        )}
        {filteredModels.map(model => (
          <button
            key={model.id}
            type="button"
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left system-xs-regular text-text-secondary hover:bg-state-base-hover-alt',
              (multiSelect ? selectedModelIds.includes(model.id) : model.id === modelId) && 'bg-accent text-text-primary',
            )}
            onClick={() => {
              if (multiSelect) {
                const checked = selectedModelIds.includes(model.id)
                toggleModelSelection(model.id, !checked)
                return
              }
              setModelId(model.id)
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              {multiSelect && (
                <Checkbox
                  checked={selectedModelIds.includes(model.id)}
                  onCheckedChange={value => toggleModelSelection(model.id, value === true)}
                  onClick={event => event.stopPropagation()}
                  aria-label={`选择模型 ${model.id}`}
                />
              )}
              <span className="truncate font-mono">{model.id}</span>
            </div>
            {model.ownedBy && (
              <span className="shrink-0 system-2xs-regular text-text-quaternary">{model.ownedBy}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
