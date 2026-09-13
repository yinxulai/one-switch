import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

interface SortableLogicalModelProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

export function SortableLogicalModel(props: SortableLogicalModelProps) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform: sortableTransform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: ({ isSorting }) => isSorting,
  })
  // 卡片高度不一致时，dnd-kit 会把正在拖动的卡片缩放到它悬停的那张卡片的大小（等高网格里看不出来，
  // 瀑布流里会明显拉伸），所以拖动时只保留位移，让卡片以原尺寸跟着指针走。
  const transform = isDragging && sortableTransform ? { ...sortableTransform, scaleX: 1, scaleY: 1 } : sortableTransform
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('min-w-0', isDragging && 'relative z-10')}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  )
}
