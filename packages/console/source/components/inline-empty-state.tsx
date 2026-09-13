import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InlineEmptyStateProps {
  title: string
  description?: string
  icon?: LucideIcon
  className?: string
}

/** 卡片 / 列表内部的轻量空状态：没有整页空状态那么大，但仍然带图标与说明。 */
export function InlineEmptyState(props: InlineEmptyStateProps) {
  const Icon = props.icon

  return (
    <div className={cn('flex flex-col items-center gap-1.5 px-5 py-10 text-center', props.className)}>
      {Icon ? <Icon size={20} strokeWidth={1.5} aria-hidden className="mb-0.5 text-text-quaternary" /> : null}
      <p className="system-xs-medium text-text-primary">{props.title}</p>
      {props.description ? <p className="system-xs-regular text-text-tertiary">{props.description}</p> : null}
    </div>
  )
}
