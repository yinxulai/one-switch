import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { MasonryGrid, masonryCollisionDetection, masonrySortingStrategy } from '@/components/masonry-grid'
import { ProxyToggleButton } from '@/components/proxy-toggle-button'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { Plug, Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from '@/i18n/provider'
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { SortableContext, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useLogicalModelControlService } from './service'
import { useLogicalModels, useLogicalModelsActions } from '@/features/logical-models/hooks'
import { LogicalModelCard } from './components/logical-model-card'
import { LogicalModelSummary } from './components/logical-model-summary'
import { SortableLogicalModel } from './components/sortable-logical-model'
import { AddProviderModelDialog } from './components/add-provider-model-dialog'
import { CreateLogicalModelDialog } from './components/create-logical-model-dialog'
import { schedulingPolicyApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { isBuiltInDefaultLogicalModel, type LogicalModel, type ProviderModelRoute } from '@common/schemas'

interface LogicalModelsPageProps {
  onNavigateToModels?: () => void
  onNavigateToAccess?: () => void
  onNavigateToProviderAnalytics?: (providerId: string) => void
}

interface LogicalModelColumnProps {
  logicalModel: LogicalModel
  onNavigateToProviderAnalytics?: (providerId: string) => void
  dragHandleProps?: Record<string, unknown>
  dragging?: boolean
}

function LogicalModelColumn(props: LogicalModelColumnProps) {
  const { logicalModel, onNavigateToProviderAnalytics, dragHandleProps, dragging } = props
  const service = useLogicalModelControlService(logicalModel.id)
  const confirm = useConfirm()
  const toast = useToast()
  const t = useTranslation()
  const [addModelOpen, setAddModelOpen] = useState(false)
  const removeModel = async (model: ProviderModelRoute) => {
    const confirmed = await confirm({
      title: t('logicalModels.remove.title'),
      description: t('logicalModels.remove.description', { name: logicalModel.name, model: model.modelName }),
      confirmLabel: t('logicalModels.remove.confirm'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await unwrap(schedulingPolicyApi.remove(logicalModel.id, model.id))
      await service.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('logicalModels.remove.failed'))
    }
  }
  return (
    <>
      <LogicalModelCard
        logicalModelName={logicalModel.name}
        logicalModelDescription={logicalModel.description}
        builtIn={isBuiltInDefaultLogicalModel(logicalModel)}
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
        dragHandleProps={dragHandleProps}
        dragging={dragging}
      />
      <AddProviderModelDialog open={addModelOpen} logicalModelId={logicalModel.id} onOpenChange={setAddModelOpen} onAdded={() => void service.reload()} />
    </>
  )
}

export function LogicalModelsPage(props: LogicalModelsPageProps) {
  const { onNavigateToAccess, onNavigateToProviderAnalytics } = props
  const toast = useToast()
  const logicalModels = useLogicalModels()
  const { refresh: refreshLogicalModels, reorder: reorderLogicalModels } = useLogicalModelsActions()
  const service = useLogicalModelControlService('default')
  const t = useTranslation()
  const [createLogicalModelOpen, setCreateLogicalModelOpen] = useState(false)
  const proxyRunning = service.proxyStatus?.running ?? false
  const enabledLogicalModels = logicalModels.filter(model => model.enabled)
  const enabledIds = useMemo(() => logicalModels.filter(model => model.enabled).map(model => model.id), [logicalModels])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleReorder = useCallback(async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = logicalModels.findIndex(model => model.id === active.id)
    const newIndex = logicalModels.findIndex(model => model.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(logicalModels, oldIndex, newIndex)
    try {
      await reorderLogicalModels(reordered.map(model => model.id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [logicalModels, reorderLogicalModels, toast])

  return (
    <PageLayout>
      <PageHeader
        title={t('logicalModels.title')}
        description={t('logicalModels.description')}
        actions={(
          <div className="flex items-center gap-2">
            <Button onClick={() => setCreateLogicalModelOpen(true)}>
              <Plus size={13} /> {t('logicalModels.create.open')}
            </Button>
            {onNavigateToAccess && (
              <Button variant="outline" onClick={onNavigateToAccess}>
                <Plug size={13} /> {t('logicalModels.goToAccess')}
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
            <LogicalModelSummary models={service.models} summaryMetrics={service.summaryMetrics} />

            <DndContext
              sensors={sensors}
              collisionDetection={masonryCollisionDetection}
              modifiers={[restrictToWindowEdges]}
              onDragEnd={event => void handleReorder(event)}
            >
              {/* 瀑布流里卡片高度不等，用 masonrySortingStrategy，避免拖动时卡片被纵向压扁。 */}
              <SortableContext items={enabledIds} strategy={masonrySortingStrategy}>
                <MasonryGrid
                  items={enabledLogicalModels.map(model => ({
                    id: model.id,
                    node: (
                      <SortableLogicalModel id={model.id}>
                        {(handleProps, dragging) => (
                          <LogicalModelColumn
                            logicalModel={model}
                            onNavigateToProviderAnalytics={onNavigateToProviderAnalytics}
                            dragHandleProps={handleProps}
                            dragging={dragging}
                          />
                        )}
                      </SortableLogicalModel>
                    ),
                  }))}
                />
              </SortableContext>
            </DndContext>
            <CreateLogicalModelDialog
              open={createLogicalModelOpen}
              onOpenChange={setCreateLogicalModelOpen}
              onCreated={refreshLogicalModels}
            />
          </>
        )}
      </PageContent>
    </PageLayout>
  )
}
