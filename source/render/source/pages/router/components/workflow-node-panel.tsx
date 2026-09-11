import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { PANEL_COMPONENT_MAP } from '../panel'
import { isProtectedNode, nodePanelHint } from '../node-meta'
import type { NodePanelUpdate, NodePanelProps as NodePanelBodyProps } from '../node-data'
import type { WorkflowNodeModel } from '../types'
import { BlockIcon } from './block-icon'

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

  useEffect(() => {
    if (width > maxWidth) onWidthChange(maxWidth)
  }, [maxWidth, onWidthChange, width])

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

  return (
    <aside className="absolute top-0 right-0 bottom-0 z-10 flex outline-hidden">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整面板宽度"
        onPointerDown={handleResizeStart}
        className="group/resize flex w-2 shrink-0 cursor-col-resize items-center justify-center"
      >
        <span
          className={cn(
            'h-10 w-0.5 rounded-full bg-muted-foreground/20 transition-all',
            dragging ? 'h-full bg-primary' : 'group-hover/resize:h-full group-hover/resize:bg-primary/70',
          )}
        />
      </div>

      <div
        className="flex h-full min-w-0 flex-col overflow-hidden bg-popover"
        style={{ width: `${boundedWidth}px` }}
      >
        <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-1.5">
          <BlockIcon kind={model.kind} size="md" />

          {protectedNode
            ? <span className="min-w-0 flex-1 truncate text-sm font-semibold">{model.name}</span>
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
            aria-label="关闭面板"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        <div className="shrink-0 px-3 py-1">
          {protectedNode
            ? <div className="text-[11px] leading-4 text-muted-foreground/80">{model.description}</div>
            : (
              <Textarea
                value={model.description}
                onChange={event => updateNode(model.id, current => ({ ...current, description: event.target.value }))}
                placeholder="节点描述"
                className="min-h-14 text-xs"
              />
            )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
          <div className="grid gap-3">
            <div className="rounded-lg bg-muted/35 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
              {nodePanelHint(model)}
            </div>

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
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDelete(model.id)}
            >
              <Trash2 className="size-3.5" /> 删除节点
            </Button>
          </div>
        )}
      </div>
    </aside>
  )
}
