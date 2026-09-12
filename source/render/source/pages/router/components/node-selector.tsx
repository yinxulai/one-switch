import { useMemo, useState, type MouseEvent } from 'react'
import { Plus, Search } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { APPENDABLE_KINDS, NODE_KIND_META } from '../node-meta'
import type { AppendableKind } from '@common/router/types'
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
  /** 节点已选中时端口按钮常驻（对应 Dify 的 `data.selected && 'opacity-100'`） */
  alwaysVisible?: boolean
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
    alwaysVisible = false,
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
        'absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-components-button-primary-bg text-components-button-primary-text transition-opacity duration-150',
        'hover:bg-components-button-primary-bg-hover',
        variant === 'handle' ? 'size-4' : 'size-5',
        // 逐字对应 Dify block-selector 触发器的 `opacity-0 pointer-events-none group-hover:opacity-100`：
        // 默认收起，悬浮节点或已选中时才显形。
        'pointer-events-none opacity-0 group-hover/node:pointer-events-auto group-hover/node:opacity-100',
        'data-[state=open]:pointer-events-auto data-[state=open]:opacity-100',
        alwaysVisible && 'pointer-events-auto opacity-100',
      )}
      // **不能**在这里阻断 mousedown / pointerdown：xyflow 把连接手势挂在
      // `<Handle onMouseDown={...}>` 上（v12 里 `onMouseDown: onPointerDown`），
      // 而 + 钮是 Handle 的 16px 子节点、悬浮节点时会整个盖住端口热区。
      // 一旦阻断冒泡，Handle 的 React 处理器就收不到事件，端口将彻底无法拖出连线。
      // Dify 的 block-selector 同样只在 click 上 `stopPropagation()`。
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
        // `workflow-dify-surface`：浮层被 portal 到 body，脱离画布作用域，需要自带圆角还原标记。
        // `gap-0 rounded-xl p-1.5 shadow-none ring-0` 覆盖 shadcn PopoverContent 默认的圆角 / 阴影 / 描边。
        className={cn('workflow-dify-surface w-64 gap-0 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1.5 shadow-none ring-0', className)}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 rounded-lg bg-components-input-bg-normal px-2 py-1.5">
          <Search className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
          <input
            autoFocus
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="搜索节点"
            className="h-5 w-full min-w-0 bg-transparent system-xs-regular text-components-input-text-filled outline-none placeholder:text-components-input-text-placeholder"
          />
        </div>

        <div className="mt-1 max-h-72 overflow-y-auto">
          {items.map(item => (
            <button
              key={item.kind}
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-state-base-hover"
              onClick={() => {
                handleOpenChange(false)
                onSelect(item.kind)
              }}
            >
              <BlockIcon kind={item.kind} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate system-xs-medium text-text-primary">{item.meta.label}</span>
                <span className="mt-0.5 block truncate system-2xs-regular text-text-tertiary">{item.meta.hint}</span>
              </span>
            </button>
          ))}

          {items.length === 0 && (
            <div className="px-2 py-4 text-center system-xs-regular text-text-tertiary">没有匹配的节点</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
