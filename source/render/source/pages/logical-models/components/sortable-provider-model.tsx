import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

interface SortableProviderModelProps {
  id: string
  children: (handleProps: Record<string, unknown>, dragging: boolean) => ReactNode
}

export function SortableProviderModel(props: SortableProviderModelProps) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: ({ isSorting }) => isSorting,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative overflow-hidden border-b border-border/50 bg-card last:border-b-0',
        isDragging && 'z-10 overflow-visible bg-accent',
      )}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  )
}
