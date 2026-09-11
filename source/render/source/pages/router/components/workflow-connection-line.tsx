import { getBezierPath, type ConnectionLineComponentProps } from '@xyflow/react'

/**
 * 拖动连线时的预览线。
 * 复制自 Dify `app/components/workflow/custom-connection-line.tsx`，
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
        stroke="hsl(var(--muted-foreground) / 0.55)"
        strokeWidth={2}
        strokeDasharray="6 6"
        d={edgePath}
      />
      <rect
        x={toX - 3}
        y={toY - 5}
        width={6}
        height={10}
        rx={3}
        fill="hsl(var(--primary))"
      />
    </g>
  )
}
