import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ListTree, GripVertical, RefreshCw, Target } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { SortableProviderModel } from './sortable-provider-model'
import { ProviderModelRow } from './provider-model-row'
import { providerModelMetricKey, type ProviderModelMetrics } from '../lib/model-metrics'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_DESCRIPTION } from '@common/schemas'
import type { ProviderModelRoute, Provider, ProviderHealth, ProviderModelHealth } from '@common/schemas'

export type ProviderMap = Record<string, Provider>
export type HealthMap = Record<string, ProviderHealth>
export type ProviderModelHealthMap = Record<string, ProviderModelHealth>

interface LogicalModelCardProps {
  logicalModelName: string
  /** 逻辑模型的用途说明；空串时以 `—` 占位，避免卡片头高度随数据有无变化。 */
  logicalModelDescription: string
  /** 内建兜底逻辑模型（请求未命中任何其他逻辑模型时的落点）。 */
  builtIn?: boolean
  models: ProviderModelRoute[]
  providers: ProviderMap
  health: HealthMap
  providerModelHealth: ProviderModelHealthMap
  modelMetrics: Record<string, ProviderModelMetrics>
  mode: 'auto' | 'manual'
  manualModelId: string
  switchingMode: boolean
  isCooling: (providerId: string, providerModelId: string) => boolean
  onModeChange: (mode: 'auto' | 'manual') => void
  onSelectManualModel: (model: ProviderModelRoute) => void
  onToggleEnabled: (model: ProviderModelRoute, enabled: boolean) => void
  onDragEnd: (event: DragEndEvent) => void
  onNavigateToProviderAnalytics?: (providerId: string) => void
  onAddModel?: () => void
  onRemoveModel?: (model: ProviderModelRoute) => void
  dragHandleProps?: Record<string, unknown>
  dragging?: boolean
}

export function LogicalModelCard(props: LogicalModelCardProps) {
  const {
    logicalModelName,
    logicalModelDescription,
    builtIn,
    models,
    providers,
    health,
    providerModelHealth,
    modelMetrics,
    mode,
    manualModelId,
    switchingMode,
    isCooling,
    onModeChange,
    onSelectManualModel,
    onToggleEnabled,
    onDragEnd,
    onNavigateToProviderAnalytics,
    onAddModel,
    onRemoveModel,
    dragHandleProps,
    dragging,
  } = props
  const t = useTranslation()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const itemIds = useMemo(() => models.map(model => model.id), [models])
  const rows = models.map(model => ({
    model,
    cooling: isCooling(model.providerId, model.id),
    selected: mode === 'manual' && manualModelId === model.id,
  }))
  const coolingCount = rows.filter(row => row.cooling).length

  // 内建默认逻辑模型的说明来自服务端种子，用户没有编辑入口，所以它等价于系统文案。
  // 值恰好等于种子常量时换成目录里的本地化文案；用户自己写过的说明原样显示。
  const description = builtIn && logicalModelDescription === BUILT_IN_DEFAULT_LOGICAL_MODEL_DESCRIPTION
    ? t('logicalModels.card.builtInDescription')
    : logicalModelDescription

  // 卡片头分两行：上行是身份（名称 + 状态）与调度模式，下行是说明。
  // 单行放不下「标题 + 添加模型 + 模式切换」——瀑布流最窄 420px，标题会被挤断。
  const renderHeader = () => (
    <CardHeader className="group/header border-b border-border/50 pb-3">
      {/* 手柄跟着标题所在的那一行：拆成「手柄列 + 两行文字」时它会按整块高度居中，
          而这一行被右侧的模式标签页撑高了，图标就比标题低半个字。 */}
      <div className="flex w-full items-center">
        <button
          type="button"
          className={cn(
            // 静止时宽度收成 0（图标被裁掉），浮入卡片头才撑开，所以不显示时它完全不占位置。
            'flex h-5 w-0 shrink-0 cursor-grab touch-none select-none items-center justify-center overflow-hidden rounded text-text-quaternary transition-[width,color] hover:text-text-primary focus-visible:w-7 focus-visible:bg-accent focus-visible:text-text-primary focus-visible:outline-none active:cursor-grabbing',
            // 静态画面里它只是一个没有文字的图标，浮入卡片头才出现（20px + 8px 间距）。
            dragging ? 'w-7' : 'group-hover/header:w-7',
          )}
          aria-label={t('logicalModels.card.dragAria', { name: logicalModelName })}
          title={t('logicalModels.card.dragTitle')}
          {...dragHandleProps}
        >
          <GripVertical size={16} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle className="truncate">{logicalModelName}</CardTitle>
            {builtIn && <Badge variant="muted" className="shrink-0">{t('logicalModels.card.builtIn')}</Badge>}
            {coolingCount > 0 && <Badge variant="destructive" className="shrink-0">{t('logicalModels.card.cooling', { count: coolingCount })}</Badge>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onAddModel && <Button variant="outline" size="sm" onClick={onAddModel}>{t('logicalModels.card.addModel')}</Button>}
            <Tabs value={mode} onValueChange={value => onModeChange(value as 'auto' | 'manual')}>
              <TabsList>
                <TabsTrigger value="auto" disabled={switchingMode} className="px-2.5 system-xs-medium"><RefreshCw size={12} className={switchingMode ? 'animate-spin' : undefined} /> {t('logicalModels.card.mode.auto')}</TabsTrigger>
                <TabsTrigger value="manual" disabled={switchingMode} className="px-2.5 system-xs-medium"><Target size={12} /> {t('logicalModels.card.mode.manual')}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>
      {/* 说明与标题同一起点：手柄撑开多宽（28px）这里就补多少内边距，过渡与手柄同速，
          于是手柄收起时两行都贴左、浮入时两行一起右移。 */}
      <CardDescription className="w-full truncate transition-[padding] group-hover/header:pl-7" title={description || undefined}>
        {description || '—'}
      </CardDescription>
    </CardHeader>
  )

  const renderProviderModelTable = () => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={event => void onDragEnd(event)}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div className="max-h-96 overflow-x-auto overflow-y-auto rounded-b-lg">
          {rows.map(row => (
            <SortableProviderModel key={row.model.id} id={row.model.id}>
              {(handleProps, dragging) => (
                <ProviderModelRow
                  model={row.model}
                  provider={providers[row.model.providerId]}
                  providerHealth={health[row.model.providerId]}
                  providerModelHealth={providerModelHealth[row.model.id]}
                  metrics={modelMetrics[providerModelMetricKey(row.model.providerId, row.model.id)]}
                  mode={mode}
                  selected={row.selected}
                  cooling={row.cooling}
                  dragging={dragging}
                  dragHandleProps={handleProps}
                  onSelect={() => void onSelectManualModel(row.model)}
                  onToggleEnabled={enabled => void onToggleEnabled(row.model, enabled)}
                  onNavigateToProviderAnalytics={onNavigateToProviderAnalytics}
                  onRemove={() => onRemoveModel?.(row.model)}
                />
              )}
            </SortableProviderModel>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )

  // 空状态不再挂「添加模型」按钮：卡片头已经有了，同一张卡里放两遍只会分不清主次。
  const renderEmptyState = () => (
    <EmptyState
      icon={ListTree}
      title={t('logicalModels.card.empty.title')}
      description={t('logicalModels.card.empty.description')}
      className="min-h-48 border-0 py-10"
    />
  )

  const renderContent = () => {
    if (models.length === 0) return renderEmptyState()
    return renderProviderModelTable()
  }

  return (
    <Card className={cn('group overflow-hidden', dragging && 'bg-accent')}>
      {renderHeader()}
      <CardContent className="p-0">{renderContent()}</CardContent>
    </Card>
  )
}
