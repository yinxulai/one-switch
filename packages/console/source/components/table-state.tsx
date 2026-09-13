import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TableStateRowProps {
  colSpan: number
  icon: LucideIcon
  title: string
  description?: string
  tone?: 'muted' | 'destructive'
  action?: ReactNode
  className?: string
}

/**
 * 表格的「没有数据」占位行：空结果、读取失败、以及各种没法填满表格的情况都走这里。
 *
 * 库里的表格从 3 列到 10 列不等，所以用 `colSpan` 跨满整行，
 * 避免每个表格各写一套裸 `<td className="px-4 py-12 text-center">`。
 */
export function TableStateRow(props: TableStateRowProps) {
  const Icon = props.icon
  const isDestructive = props.tone === 'destructive'

  return (
    <tr>
      <td colSpan={props.colSpan} className={cn('px-4 py-14 text-center', props.className)}>
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
          <Icon size={22} strokeWidth={1.5} aria-hidden className={isDestructive ? 'text-text-destructive' : 'text-text-quaternary'} />
          <p className={cn('system-xs-medium', isDestructive ? 'text-text-destructive' : 'text-text-primary')}>{props.title}</p>
          {props.description ? <p className="system-xs-regular text-text-tertiary">{props.description}</p> : null}
          {props.action}
        </div>
      </td>
    </tr>
  )
}
