type EdgeLinearGradientPosition = {
  x1: number
  y1: number
  x2: number
  y2: number
}

type EdgeLinearGradientProps = {
  /** 同时作为 gradient 的 id 与 svg url(#id) 的引用键 */
  id: string
  /** 起点色（上游节点状态色） */
  startColor: string
  /** 终点色（下游节点状态色） */
  stopColor: string
  position: EdgeLinearGradientPosition
}

/**
 * 运行中的连线渐变。
 * 逐行复制自上游 `app/components/workflow/custom-edge-linear-gradient-render.tsx`，
 * 只把 props 类型换成具名 type（仓库 lint 约定）。
 */
export function EdgeLinearGradient(props: EdgeLinearGradientProps) {
  const { id, startColor, stopColor, position } = props
  const { x1, y1, x2, y2 } = position

  return (
    <defs>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
        <stop
          offset="0%"
          style={{
            stopColor: startColor,
            stopOpacity: 1,
          }}
        />
        <stop
          offset="100%"
          style={{
            stopColor: stopColor,
            stopOpacity: 1,
          }}
        />
      </linearGradient>
    </defs>
  )
}
