import { getBezierPath, type ConnectionLineComponentProps } from '@xyflow/react'

/**
 * 拖动连线时的预览线。
 * 复制自 Dify `app/components/workflow/custom-connection-line.tsx`（端点方块 2×8 + 2px 实线），
 * 颜色换成 Dify 的 workflow-link-line token；
 * 区别是端点位置跟随真实端口方向，而不是固定 Right → Left。
 */
export function WorkflowConnectionLine(props: ConnectionLineComponentProps) {
  const { fromX, fromY, toX, toY, fromPosition, toPosition } = props

  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
    curvature: 0.16,
  })

  return (
    <g>
      <path
        fill="none"
        stroke="var(--color-workflow-link-line-normal)"
        strokeWidth={2}
        d={edgePath}
      />
      <rect
        x={toX}
        y={toY - 4}
        width={2}
        height={8}
        fill="var(--color-workflow-link-line-active)"
      />
    </g>
  )
}
