import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'

export const tableHeaderClass = 'border-b border-border/50 bg-inset text-left system-2xs-medium text-text-tertiary'
export const tableHeaderCellClass = 'px-3 py-2 font-medium'
export const tableCellClass = 'px-3 py-2.5'
export const tableRowClass = 'border-b border-border/40 transition-colors last:border-0 hover:bg-state-base-hover'

interface TableFrameProps {
  children: ReactNode
  className?: string
}

interface TablePagerProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  disabled?: boolean
}

export function TableFrame(props: TableFrameProps) {
  return <div className={cn('overflow-hidden rounded-lg border border-module-border bg-card', props.className)}>{props.children}</div>
}

export function TableViewport(props: TableFrameProps) {
  return <div className={cn('overflow-x-auto', props.className)}>{props.children}</div>
}

export function TableHeaderSurface(props: TableFrameProps) {
  return <div className={cn(tableHeaderClass, props.className)}>{props.children}</div>
}

/** 表格分页条：请求记录、运行日志这类长列表共用同一套翻页控件与计数排版。 */
export function TablePager(props: TablePagerProps) {
  const t = useTranslation()
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="system-xs-regular text-text-tertiary">{t('common.pagination.page', { page: props.page, totalPages: props.totalPages })}</span>
      <Button variant="outline" size="icon-sm" aria-label={t('common.pagination.previous')} disabled={props.disabled === true || props.page <= 1} onClick={() => props.onPageChange(props.page - 1)}>
        <ChevronLeft size={14} />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label={t('common.pagination.next')} disabled={props.disabled === true || props.page >= props.totalPages} onClick={() => props.onPageChange(props.page + 1)}>
        <ChevronRight size={14} />
      </Button>
    </div>
  )
}
