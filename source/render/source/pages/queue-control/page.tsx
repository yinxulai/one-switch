import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { ProxyToggleButton } from '@/components/proxy-toggle-button'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Plug, Plus } from 'lucide-react'
import { useState } from 'react'
import { useQueueControlService } from './service'
import { useLogicalModels, useLogicalModelsActions } from '@/features/logical-models/hooks'
import { QueueListCard } from './components/queue-list-card'
import { QueueSummary } from './components/queue-summary'
import { AddQueueModelDialog } from './components/add-queue-model-dialog'
import { CreateQueueDialog } from './components/create-queue-dialog'
import { schedulingPolicyApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import type { ProviderModelRoute } from '@common/schemas'

interface QueueControlPageProps {
  onNavigateToModels?: () => void
  onNavigateToAccess?: () => void
  onNavigateToProviderAnalytics?: (providerId: string) => void
}

interface QueueColumnProps {
  logicalModelId: string
  logicalModelName: string
  onNavigateToProviderAnalytics?: (providerId: string) => void
}

function QueueColumn(props: QueueColumnProps) {
  const { logicalModelId, logicalModelName, onNavigateToProviderAnalytics } = props
  const service = useQueueControlService(logicalModelId)
  const [addModelOpen, setAddModelOpen] = useState(false)
  const removeModel = async (model: ProviderModelRoute) => {
    if (!window.confirm(`确定从“${logicalModelName}”队列移除 ${model.modelName} 吗？`)) return
    try {
      await unwrap(schedulingPolicyApi.remove(logicalModelId, model.id))
      await service.reload()
    } catch (error) {
      console.error(error)
    }
  }
  return (
    <>
      <QueueListCard
        logicalModelName={logicalModelName}
        models={service.models}
        providers={service.providers}
        health={service.health}
        providerModelHealth={service.providerModelHealth}
        modelMetrics={service.modelMetrics}
        mode={service.mode}
        manualModelId={service.manualModelId ?? ''}
        switchingMode={service.switchingMode}
        isCooling={service.isCooling}
        onModeChange={mode => void service.changeMode(mode)}
        onSelectManualModel={service.selectManualModel}
        onToggleEnabled={service.updateEnabled}
        onDragEnd={service.handleDragEnd}
        onNavigateToProviderAnalytics={onNavigateToProviderAnalytics}
        onAddModel={() => setAddModelOpen(true)}
        onRemoveModel={model => void removeModel(model)}
      />
      <AddQueueModelDialog open={addModelOpen} logicalModelId={logicalModelId} onOpenChange={setAddModelOpen} onAdded={() => void service.reload()} />
    </>
  )
}

export function QueueControlPage(props: QueueControlPageProps) {
  const { onNavigateToAccess, onNavigateToProviderAnalytics } = props
  const logicalModels = useLogicalModels()
  const { refresh: refreshLogicalModels } = useLogicalModelsActions()
  const service = useQueueControlService('default')
  const [createQueueOpen, setCreateQueueOpen] = useState(false)
  const proxyRunning = service.proxyStatus?.running ?? false
  const enabledLogicalModels = logicalModels.filter(model => model.enabled)

  return (
    <PageLayout>
      <PageHeader
        title="模型队列"
        description="管理请求优先级、切换模式和模型启停"
        actions={(
          <div className="flex items-center gap-2">
            <Button onClick={() => setCreateQueueOpen(true)}>
              <Plus size={13} /> 创建队列
            </Button>
            {onNavigateToAccess && (
              <Button variant="outline" onClick={onNavigateToAccess}>
                <Plug size={13} /> 接入配置
              </Button>
            )}
            <ProxyToggleButton running={proxyRunning} onToggle={service.toggleProxy} />
          </div>
        )}
      />
      <PageContent>
        {service.loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="p-3">
                  <Skeleton className="mb-2 h-3 w-20" />
                  <Skeleton className="mb-2 h-6 w-10" />
                  <Skeleton className="h-2.5 w-28" />
                </Card>
              ))}
            </div>
            <Card className="p-4">
              <Skeleton className="mb-4 h-5 w-24" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-5 w-5 rounded-sm" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-1/3" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                    <Skeleton className="h-6 w-16" />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : (
          <>
            <QueueSummary models={service.models} summaryMetrics={service.summaryMetrics} />

            <div className={`grid gap-4 ${enabledLogicalModels.length === 1 ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
              {enabledLogicalModels.map(model => (
                <QueueColumn
                  key={model.id}
                  logicalModelId={model.id}
                  logicalModelName={model.name}
                  onNavigateToProviderAnalytics={onNavigateToProviderAnalytics}
                />
              ))}
            </div>
            <CreateQueueDialog
              open={createQueueOpen}
              onOpenChange={setCreateQueueOpen}
              onCreated={refreshLogicalModels}
            />
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
