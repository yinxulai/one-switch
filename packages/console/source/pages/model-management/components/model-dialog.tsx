import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FORM_DIALOG_BODY_CLASSNAME, FormField, FormGroup, FormHint } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { FetchedModelPicker } from './fetched-model-picker'
import { ModelProtocolEndpointCard } from './model-protocol-endpoint-card'
import { ProviderRuleBindings } from './provider-rule-bindings'
import type { FetchedProviderModel } from '@/api/providers'
import type { ProtocolEndpointEntry } from '../hooks/types'

interface ModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingModel: { id: string; modelName: string } | null
  providerName: string
  modelId: string
  protocolEntries: ProtocolEndpointEntry[]
  saving: boolean
  fetchedModels: FetchedProviderModel[]
  fetchingModels: boolean
  selectedModelIds: string[]
  onFetchModels: () => void
  setModelId: (id: string) => void
  toggleModelSelection: (id: string, checked: boolean) => void
  selectAllFetchedModels: (ids: string[]) => void
  invertFetchedModels: (ids: string[]) => void
  clearSelectedModels: () => void
  updateProtocolEntry: (index: number, patch: Partial<ProtocolEndpointEntry>) => void
  onCancel: () => void
  onSave: () => void
}

export function ModelDialog(props: ModelDialogProps) {
  const {
    open,
    onOpenChange,
    editingModel,
    providerName,
    modelId,
    protocolEntries,
    saving,
    fetchedModels,
    fetchingModels,
    selectedModelIds,
    onFetchModels,
    setModelId,
    toggleModelSelection,
    selectAllFetchedModels,
    invertFetchedModels,
    clearSelectedModels,
    updateProtocolEntry,
    onCancel,
    onSave,
  } = props

  const t = useTranslation()
  const canSave = (editingModel ? modelId.trim() : selectedModelIds.length > 0 || modelId.trim()) && protocolEntries.some(entry => entry.enabled)

  const [modelSearch, setModelSearch] = useState('')
  const filteredModels = useMemo(() => {
    const keyword = modelSearch.trim().toLowerCase()
    if (!keyword) return fetchedModels
    return fetchedModels.filter(model =>
      model.id.toLowerCase().includes(keyword) ||
      (model.displayName ?? '').toLowerCase().includes(keyword))
  }, [fetchedModels, modelSearch])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        onPointerDownOutside={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{editingModel ? t('models.dialog.editTitle') : t('models.dialog.addTitle')}</DialogTitle>
          <DialogDescription>
            {t('models.dialog.descriptionPrefix')}<span className="font-medium">{providerName}</span>{t('models.dialog.descriptionSuffix')}
          </DialogDescription>
        </DialogHeader>

        <div className={FORM_DIALOG_BODY_CLASSNAME}>
          {/* 模型 ID */}
          <FormField label={t('models.dialog.modelIdLabel')} htmlFor="model-id" hint={t('models.dialog.modelIdHint')}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="model-id"
                value={modelId}
                onChange={event => setModelId(event.target.value)}
                placeholder={t('models.dialog.modelIdPlaceholder')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={fetchingModels}
                onClick={onFetchModels}
                className="h-8 shrink-0"
              >
                <RefreshCw size={13} className={cn(fetchingModels && 'animate-spin')} />
                {fetchingModels ? t('models.dialog.fetching') : t('models.dialog.fetch')}
              </Button>
            </div>

            <FetchedModelPicker
              modelId={modelId}
              multiSelect={!editingModel}
              selectedModelIds={selectedModelIds}
              fetchedModels={fetchedModels}
              modelSearch={modelSearch}
              setModelSearch={setModelSearch}
              setModelId={setModelId}
              toggleModelSelection={toggleModelSelection}
              onSelectAllFiltered={selectAllFetchedModels}
              onInvertFiltered={invertFetchedModels}
              onClearSelection={clearSelectedModels}
              filteredModels={filteredModels}
            />
            {!editingModel && selectedModelIds.length > 0 && (
              <FormHint>{t('models.dialog.selectedHint', { count: selectedModelIds.length })}</FormHint>
            )}
          </FormField>

          {/* 协议端点 */}
          <FormGroup
            title={t('models.dialog.endpointsTitle')}
            description={t('models.dialog.endpointsDescription')}
          >
            {protocolEntries.map((entry, index) => (
              <ModelProtocolEndpointCard
                key={entry.protocol}
                entry={entry}
                index={index}
                updateProtocolEntry={updateProtocolEntry}
              />
            ))}
          </FormGroup>

          {editingModel && <ProviderRuleBindings providerModelId={editingModel.id} embedded />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('common.action.cancel')}</Button>
          <Button disabled={saving || !canSave} onClick={onSave}>
            {saving ? t('common.action.saving') : editingModel ? t('models.dialog.save') : selectedModelIds.length > 0 ? t('models.dialog.submitBulk', { count: selectedModelIds.length }) : t('models.dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
