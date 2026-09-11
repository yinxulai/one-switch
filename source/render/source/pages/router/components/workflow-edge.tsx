import { memo, useMemo, useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  type EdgeProps,
} from '@xyflow/react'
import { Plus } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { WorkflowFlowEdge } from '../graph-model'
import { EDGE_STROKE_HANDLE, EDGE_STROKE_NORMAL, edgeRunStatusStroke } from '../node-meta'
import { EdgeLinearGradient } from './edge-linear-gradient'
import { NodeSelector } from './node-selector'

/** 渐变端点必须处在“已完成”与“已开始”的状态组合上，判定与 Dify 一致。 */
function canRenderGradient(sourceStatus: string, targetStatus: string): boolean {
  const sourceDone = sourceStatus === 'succeeded' || sourceStatus === 'failed'
  const targetStarted = targetStatus === 'succeeded' || targetStatus === 'failed' || targetStatus === 'running'
  return sourceDone && targetStarted
}

/**
 * 自定义连线。
 * 路径、渐变与状态着色复制自 Dify `app/components/workflow/custom-edge.tsx`
 * 与 `custom-edge-linear-gradient-render.tsx`：两端各内缩 8px + `curvature: 0.16`，
 * 线宽固定 2，中点悬浮出现插入按钮。
 */
export const WorkflowEdge = memo(function WorkflowEdge(props: EdgeProps<WorkflowFlowEdge>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    markerEnd,
    selected,
    data,
  } = props

  const [edgeHovered, setEdgeHovered] = useState(false)
  const [triggerHovered, setTriggerHovered] = useState(false)
  const [selectorOpen, setSelectorOpen] = useState(false)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sourceX - 8,
    sourceY,
    sourcePosition: Position.Right,
    targetX: targetX + 8,
    targetY,
    targetPosition: Position.Left,
    curvature: 0.16,
  })

  const sourceRunStatus = data?.sourceRunStatus ?? 'idle'
  const targetRunStatus = data?.targetRunStatus ?? 'idle'
  const gradientVisible = useMemo(
    () => canRenderGradient(sourceRunStatus, targetRunStatus),
    [sourceRunStatus, targetRunStatus],
  )

  const canInsert = Boolean(data?.canInsert)
  const active = edgeHovered || triggerHovered || selectorOpen || Boolean(selected) || Boolean(data?.highlighted)
  const stroke = active
    ? EDGE_STROKE_HANDLE
    : gradientVisible
      ? `url(#${id})`
      : (data?.stroke ?? EDGE_STROKE_NORMAL)
  const triggerVisible = edgeHovered || triggerHovered || selectorOpen

  return (
    <>
      {gradientVisible && (
        <EdgeLinearGradient
          id={id}
          startColor={edgeRunStatusStroke(sourceRunStatus) ?? EDGE_STROKE_NORMAL}
          stopColor={edgeRunStatusStroke(targetRunStatus) ?? EDGE_STROKE_NORMAL}
          position={{ x1: sourceX, y1: sourceY, x2: targetX, y2: targetY }}
        />
      )}

      <g
        onMouseEnter={() => setEdgeHovered(true)}
        onMouseLeave={() => setEdgeHovered(false)}
      >
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            stroke,
            strokeWidth: 2,
            opacity: data?.dimmed ? 0.3 : 1,
            transition: 'stroke 150ms ease',
          }}
        />
      </g>

      {canInsert && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: triggerVisible ? 'all' : 'none',
              transition: 'opacity 150ms ease',
              opacity: triggerVisible ? 1 : 0,
            }}
            onMouseEnter={() => setTriggerHovered(true)}
            onMouseLeave={() => setTriggerHovered(false)}
          >
            <NodeSelector
              open={selectorOpen}
              onOpenChange={setSelectorOpen}
              variant="edge"
              placement="right"
              onSelect={kind => data?.onInsert?.(id, kind)}
              trigger={(
                <button
                  type="button"
                  aria-label="在连线上插入节点"
                  className={cn(
                    'flex size-4 items-center justify-center rounded-full',
                    'bg-components-button-primary-bg text-white',
                    'hover:bg-components-button-primary-bg-hover',
                    'transition-transform duration-150 hover:scale-150',
                  )}
                  onPointerDown={event => event.stopPropagation()}
                  onMouseDown={event => event.stopPropagation()}
                >
                  <Plus className="size-2.5" aria-hidden />
                </button>
              )}
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})
