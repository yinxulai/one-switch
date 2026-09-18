import { useMemo } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'
import { useModelManagement } from '@/pages/model-management/hooks/use-model-management'
import { ModelDialog } from '@/pages/model-management/components/model-dialog'
import { ProviderDialog } from '@/pages/model-management/components/provider-dialog'
import { ProviderPresetPicker } from '@/pages/model-management/components/provider-preset-picker'

/**
 * 第二步：添加模型。
 *
 * 数据模型决定了「模型」必须挂在供应商下（`ProviderModel.providerId`），所以这一步实际是
 * **供应商 + 模型一起配**：先选个预设把地址填好、填 Key 建供应商，再从该供应商拉取模型并勾选。
 *
 * 复用整条模型管理链路（`useModelManagement` + 两个对话框组件），不重写一套「引导版」表单：
 * 拉取失败、重复模型、协议端点、转换开关这些分支在正式页面里已经被打磨过，
 * 引导页要的只是同一套交互的一个入口，另写一份等于把那些分支再赌一次。
 */
export function AddModelStep() {
  const service = useModelManagement()
  const t = useTranslation()

  // 每个供应商下已有几个模型：列表要显示「这家接了几个」，但不必展开模型明细。
  const modelCountByProvider = useMemo(() => {
    const counts = new Map<string, number>()
    for (const model of service.models) {
      counts.set(model.providerId, (counts.get(model.providerId) ?? 0) + 1)
    }
    return counts
  }, [service.models])

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="system-xs-regular text-text-tertiary">{t('onboarding.models.presetHint')}</p>
        <ProviderPresetPicker providerName={service.providerName} onApplyPreset={service.openPresetDialog} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => void service.openProviderDialog()}>
            <Plus />
            {t('onboarding.models.customProvider')}
          </Button>
          <Button
            size="sm"
            disabled={!service.selectedProvider}
            onClick={() => service.openModelDialog()}
          >
            <Plus />
            {t('onboarding.models.addModel')}
          </Button>
        </div>
        {/* 没有供应商时「添加模型」无处可挂，就地说明原因，而不是让按钮静默禁用。 */}
        {!service.selectedProvider && (
          <p className="system-2xs-regular text-text-quaternary">{t('onboarding.models.addModelHint')}</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="system-xs-medium text-text-secondary">{t('onboarding.models.connectedTitle')}</p>
        {service.providers.length > 0 ? (
          <ul className="divide-y divide-border/50 overflow-hidden rounded-lg border border-module-border">
            {service.providers.map(provider => (
              <li key={provider.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate system-sm-medium text-text-primary">{provider.name}</span>
                <span className="shrink-0 system-xs-regular text-text-tertiary">
                  {t('onboarding.models.modelCount', { count: modelCountByProvider.get(provider.id) ?? 0 })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-module-border px-3 py-6 text-center system-xs-regular text-text-tertiary">
            {t('onboarding.models.empty')}
          </p>
        )}
      </div>

      <ProviderDialog
        open={service.providerDialogOpen}
        onOpenChange={service.setProviderDialogOpen}
        editingProviderId={service.editingProviderId}
        providerName={service.providerName}
        apiKey={service.apiKey}
        timeout={service.timeout}
        endpointEntries={service.providerEndpointEntries}
        saving={service.saving}
        setProviderName={service.setProviderName}
        setApiKey={service.setApiKey}
        setTimeout={service.setTimeout}
        updateEndpointEntry={service.updateProviderEndpointEntry}
        onCancel={service.closeProviderDialog}
        onSave={service.saveProvider}
      />

      <ModelDialog
        open={service.modelDialogOpen}
        onOpenChange={service.setModelDialogOpen}
        editingModel={service.editingModel}
        providerName={service.selectedProvider?.name ?? ''}
        modelId={service.modelId}
        protocolEntries={service.protocolEntries}
        saving={service.saving}
        fetchedModels={service.fetchedModels}
        fetchingModels={service.fetchingModels}
        selectedModelIds={service.selectedModelIds}
        onFetchModels={service.fetchModels}
        setModelId={service.setModelId}
        toggleModelSelection={service.toggleModelSelection}
        selectAllFetchedModels={service.selectAllFetchedModels}
        invertFetchedModels={service.invertFetchedModels}
        clearSelectedModels={service.clearSelectedModels}
        updateProtocolEntry={service.updateProtocolEntry}
        onCancel={service.closeModelDialog}
        onSave={service.saveModel}
      />
    </div>
  )
}
