import { useMemo, useState, type MouseEvent } from 'react'
import { Plus, Search } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { APPENDABLE_KINDS, NODE_KIND_META, type AppendableKind } from '../node-meta'
import { BlockIcon } from './block-icon'

export type NodeSelectorVariant = 'handle' | 'edge'

type NodeSelectorProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelect: (kind: AppendableKind) => void
  /** 可插入的节点类型，默认全部可新增节点 */
  availableKinds?: AppendableKind[]
  variant?: NodeSelectorVariant
  placement?: 'left' | 'right' | 'top' | 'bottom'
  className?: string
  /** 受控触发元件；不传时使用内置的 + 号圆钮 */
  trigger?: React.ReactElement
}

/**
 * 节点选择器。
 * 结构复制自 Dify `app/components/workflow/block-selector/index.tsx`，
 * 只保留本地需要的「单列 + 搜索」形态，去掉了插件 / 工具 / 触发器等标签页。
 */
export function NodeSelector(props: NodeSelectorProps) {
  const {
    open: openFromProps,
    onOpenChange,
    onSelect,
    availableKinds = APPENDABLE_KINDS,
    variant = 'handle',
    placement = 'right',
    className,
    trigger,
  } = props

  const [localOpen, setLocalOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const open = openFromProps === undefined ? localOpen : openFromProps

  const items = useMemo(() => {
    const normalized = keyword.trim().toLowerCase()
    return availableKinds
      .map(kind => ({ kind, meta: NODE_KIND_META[kind] }))
      .filter(item => {
        if (!normalized) return true
        return item.meta.label.toLowerCase().includes(normalized)
          || item.meta.hint.toLowerCase().includes(normalized)
          || item.kind.includes(normalized)
      })
  }, [availableKinds, keyword])

  const handleOpenChange = (next: boolean) => {
    setLocalOpen(next)
    if (!next) setKeyword('')
    onOpenChange?.(next)
  }

  const handleTriggerClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation()
  }

  const defaultTrigger = (
    <button
      type="button"
      aria-label="在此处插入节点"
      className={cn(
        'absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-none transition-opacity duration-150',
        variant === 'handle' ? 'size-4' : 'size-5',
        'pointer-events-none group-hover/node:pointer-events-auto group-hover/node:opacity-100',
        'data-[state=open]:pointer-events-auto data-[state=open]:opacity-100',
      )}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
    >
      <Plus className={variant === 'handle' ? 'size-2.5' : 'size-3'} aria-hidden />
    </button>
  )

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild onClick={handleTriggerClick}>
        {trigger ?? defaultTrigger}
      </PopoverTrigger>

      <PopoverContent
        side={placement}
        align="center"
        sideOffset={10}
        className={cn('w-64 gap-0 overflow-hidden p-1.5', className)}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="搜索节点"
            className="h-5 w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
          />
        </div>

        <div className="mt-1 max-h-72 overflow-y-auto">
          {items.map(item => (
            <button
              key={item.kind}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent"
              onClick={() => {
                handleOpenChange(false)
                onSelect(item.kind)
              }}
            >
              <BlockIcon kind={item.kind} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-foreground">{item.meta.label}</span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{item.meta.hint}</span>
              </span>
            </button>
          ))}

          {items.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">没有匹配的节点</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
