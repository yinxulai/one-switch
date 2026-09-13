import type { ReactNode } from 'react'
import { defaultAnimateLayoutChanges, useSortable } from '@dnd-kit/sortable'
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
    animateLayoutChanges: args => {
      // 避免被拖拽项在释放时出现异常回弹动画；其余项保持正常布局过渡。
      if (args.wasDragging) return false
      return defaultAnimateLayoutChanges(args)
    },
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        // 边界只由外层列表外壳提供（`border` + `divide-y`），行本身不再套一圈边框，
        // 否则同一条嵌套链上会出现「外壳边框 + 行边框 + 分隔线」三层叠线。
        'relative overflow-hidden bg-card',
        isDragging && 'z-10 overflow-visible ring-1 ring-primary/45 bg-primary/3',
      )}
    >
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  )
}
