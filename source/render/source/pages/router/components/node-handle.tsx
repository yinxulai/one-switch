import { memo, useCallback, useState, type MouseEvent } from 'react'
import { Handle, Position, type HandleType } from '@xyflow/react'

import { cn } from '@/lib/utils'
import type { NodeRunStatus, RouteNodeData } from '../node-data'
import { NodeSelector } from './node-selector'

type NodeHandleProps = {
  nodeId: string
  data: RouteNodeData
  handleId: string
  handleType: HandleType
  /** 该端口是否已经连线 */
  connected: boolean
  /** 端口对齐方式：标题行对齐（top-4）或所在行居中（top-1/2） */
  align?: 'header' | 'row'
  isConnectable?: boolean
}

/** 端口竖条按运行状态着色，对应 Dify 的 workflow-link-line-*-handle 变量。 */
const runStatusBarClassName: Partial<Record<NodeRunStatus, string>> = {
  running: 'after:bg-info',
  succeeded: 'after:bg-success',
  failed: 'after:bg-destructive',
}

/**
 * 端口（复制自 Dify `nodes/_base/components/node-handle.tsx` 的交互）。
 * 差别只在样式变量：Dify 用 `--workflow-link-line-handle`，这里映射到 muted-foreground / primary。
 */
export const NodeHandle = memo(function NodeHandle(props: NodeHandleProps) {
  const {
    nodeId,
    data,
    handleId,
    handleType,
    connected,
    align = 'header',
    isConnectable = true,
  } = props

  const [open, setOpen] = useState(false)

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    // 已被占用的 target 端口直接点开选择器会造成语义歧义，所以只做连线点。
    if (handleType === 'target') return
    setOpen(value => !value)
  }, [handleType])

  const canInsert = handleType === 'source' && data.canInsert
  // 标题行端口居中在 24px 高的图标上；分支行端口让开 px-3 的 12px 内边距（12 + 9 = 21）。
  const offsetClassName = align === 'header'
    ? (handleType === 'target' ? '-left-[9px]!' : '-right-[9px]!')
    : (handleType === 'target' ? '-left-[21px]!' : '-right-[21px]!')

  return (
    <Handle
      id={handleId}
      type={handleType}
      position={handleType === 'target' ? Position.Left : Position.Right}
      isConnectable={isConnectable}
      data-connected={connected ? 'true' : 'false'}
      onClick={handleClick}
      className={cn(
        // 逐字对齐 Dify `nodes/_base/components/node-handle.tsx` 的端口样式：
        // 16px 透明热区 + 2px × 8px 的 after 竖条。多出的 transform-none! 是为了
        // 让下面的 left/right 偏移直接生效，不再叠加 react-flow 默认的 translate(±50%)。
        'z-1 size-4! transform-none! rounded-none! border-none! bg-transparent! outline-hidden!',
        'after:absolute after:top-1 after:h-2 after:w-0.5 after:bg-muted-foreground/50',
        'transition-all hover:scale-125',
        open && 'scale-125',
        handleType === 'target' ? 'after:left-1.5' : 'after:right-1.5',
        runStatusBarClassName[data.runStatus],
        align === 'header' ? 'top-4! translate-y-0!' : 'top-1/2! -translate-y-1/2!',
        offsetClassName,
        !connected && 'after:opacity-0',
      )}
    >
      {canInsert && (
        <NodeSelector
          open={open}
          onOpenChange={setOpen}
          placement="right"
          onSelect={kind => data.onRequestInsert({ kind, prevNodeId: nodeId, prevSourcePort: handleId })}
        />
      )}
    </Handle>
  )
})
