import type { ComponentType, ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MetricItem {
  label: string
  value: ReactNode
  Icon?: ComponentType<LucideProps>
  hint?: ReactNode
}

interface MetricGridProps {
  items: MetricItem[]
  className?: string
}

export function MetricGrid(props: MetricGridProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', props.className)}>
      {props.items.map(item => (
        <div key={item.label} className="min-w-35 rounded-lg border border-module-border bg-card p-3">
          <div className="mb-1 flex items-center gap-1.5 system-xs-regular text-text-tertiary">
            {item.Icon && <item.Icon size={13} aria-hidden />}
            {item.label}
          </div>
          <div className="system-xl-semibold tabular-nums text-text-primary">{item.value}</div>
          {item.hint && <div className="mt-1 system-2xs-regular text-text-quaternary">{item.hint}</div>}
        </div>
      ))}
    </div>
  )
}
