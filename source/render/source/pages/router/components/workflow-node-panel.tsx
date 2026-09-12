import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Trash2, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { PANEL_COMPONENT_MAP } from '../panel'
import { NodePanelHint } from '../panel/panel-fields'
import { isProtectedNode, nodePanelHint } from '../node-meta'
import type { NodePanelUpdate, NodePanelProps as NodePanelBodyProps } from '../node-data'
import type { WorkflowNodeModel } from '@common/router/types'
import { BlockIcon } from './block-icon'
import { DifyButton } from './dify-button'

/** 面板最小宽度。 */
const MIN_PANEL_WIDTH = 380
/** 面板展开时至少留给画布的宽度。 */
const RESERVED_CANVAS_WIDTH = 380

export function computeMaxPanelWidth(canvasWidth: number): number {
  return Math.max(MIN_PANEL_WIDTH, Math.floor(canvasWidth - RESERVED_CANVAS_WIDTH))
}

type WorkflowNodePanelProps = {
  model: WorkflowNodeModel
  /** 画布宽度，用于限制面板最大宽度 */
  canvasWidth: number
  width: number
  onWidthChange: (width: number) => void
  nodeModels: WorkflowNodeModel[]
  logicalModels: NodePanelBodyProps['logicalModels']
  conditionFieldHints: NodePanelBodyProps['conditionFieldHints']
  updateNode: (nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => void
  onDelete: (nodeId: string) => void
  onClose: () => void
}

/**
 * 右侧节点配置面板。
 * 结构复制自 Dify `app/components/workflow/panel/index.tsx` +
 * `nodes/_base/components/workflow-panel/index.tsx`：
 * 常驻画布右侧、可拖拽改宽，替换掉原来的抽屉式配置。
 *
 * 定位使用 `fixed`（窗口级）而不是相对画布的 `absolute`：画布外层有 `overflow-hidden`
 * 与 `rounded-xl`，面板只要画在画布内部就会被裁掉圆角、且高度被限制在画布盒子里。
 * 现在面板贴满窗口右侧的整条边（上、下都到窗口边界），不会出现「面板比窗口矮一截」的观感；
 * 页面标题栏的操作按钮由页面自己让出面板宽度（见 `page.tsx` 的 `headerInset`）。
 */
export function WorkflowNodePanel(props: WorkflowNodePanelProps) {
  const {
    model,
    canvasWidth,
    width,
    onWidthChange,
    nodeModels,
    logicalModels,
    conditionFieldHints,
    updateNode,
    onDelete,
    onClose,
  } = props

  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(width)
  widthRef.current = width

  const maxWidth = computeMaxPanelWidth(canvasWidth)
  const boundedWidth = Math.min(Math.max(width, MIN_PANEL_WIDTH), maxWidth)

  // 画布变窄时把超宽的面板拽回来。
  //
  // 这里刻意用 `widthRef` 读当前宽度、而不是把 `width` 写进依赖数组：
  // 本副作用会写 `onWidthChange`（父级 `panelWidth`），如果 `width` 也是依赖，
  // 就成了「副作用写自己的依赖」，正是 Maximum update depth 的成因。
  // 依赖只留外部的 `canvasWidth` 后，只有画布真的变化才会跑一次。
  useEffect(() => {
    const current = widthRef.current
    if (current > computeMaxPanelWidth(canvasWidth)) onWidthChange(computeMaxPanelWidth(canvasWidth))
  }, [canvasWidth, onWidthChange])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widthRef.current
    let frame: number | null = null
    let pending = startWidth

    const handleMove = (moveEvent: PointerEvent) => {
      pending = startWidth + (startX - moveEvent.clientX)
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        onWidthChange(pending)
      })
    }

    const handleUp = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      onWidthChange(pending)
      setDragging(false)
    }

    setDragging(true)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [onWidthChange])

  const Body = PANEL_COMPONENT_MAP[model.kind]
  const protectedNode = isProtectedNode(model)
  const update: NodePanelUpdate = updater => updateNode(model.id, updater)
  const t = useTranslation()

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex outline-hidden">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('router.nodePanel.resizeAria')}
        onPointerDown={handleResizeStart}
        className="group/resize flex w-2 shrink-0 cursor-col-resize items-center justify-center"
      >
        <span
          className={cn(
            'h-10 w-0.5 rounded-full bg-state-base-handle transition-all',
            dragging ? 'h-full bg-state-accent-solid' : 'group-hover/resize:h-full group-hover/resize:bg-state-accent-solid/70',
          )}
        />
      </div>

      <div
        className="workflow-node-panel workflow-dify-surface flex h-full min-w-0 flex-col overflow-hidden border-l-[0.5px] border-components-panel-border bg-components-panel-bg"
        style={{ width: `${boundedWidth}px` }}
      >
        <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-1.5">
          <BlockIcon kind={model.kind} size="md" />

          {protectedNode
            ? <span className="min-w-0 flex-1 truncate system-sm-semibold text-text-primary">{model.name}</span>
            : (
              <Input
                value={model.name}
                onChange={event => updateNode(model.id, current => ({ ...current, name: event.target.value }))}
                className="h-7 min-w-0 flex-1 text-sm"
              />
            )}

          <Switch
            checked={model.enabled}
            onCheckedChange={checked => updateNode(model.id, current => ({ ...current, enabled: checked }))}
          />

          <button
            type="button"
            aria-label={t('router.nodePanel.closeAria')}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
            onClick={onClose}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        <div className="shrink-0 px-3 py-1">
          {protectedNode
            ? <div className="system-xs-regular text-text-tertiary">{model.description}</div>
            : (
              <Textarea
                value={model.description}
                onChange={event => updateNode(model.id, current => ({ ...current, description: event.target.value }))}
                placeholder={t('router.nodePanel.descriptionPlaceholder')}
                className="min-h-14 text-xs"
              />
            )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
          <div className="grid gap-3">
            <NodePanelHint>{nodePanelHint(t, model)}</NodePanelHint>

            <Body
              model={model}
              update={update}
              nodeModels={nodeModels}
              logicalModels={logicalModels}
              conditionFieldHints={conditionFieldHints}
            />
          </div>
        </div>

        {!protectedNode && (
          <div className="flex shrink-0 items-center justify-end px-3 pt-2 pb-3">
            <DifyButton
              variant="ghost-destructive"
              size="medium"
              onClick={() => onDelete(model.id)}
            >
              <Trash2 className="size-3.5" aria-hidden /> {t('router.nodeAction.delete')}
            </DifyButton>
          </div>
        )}
      </div>
    </aside>
  )
}
