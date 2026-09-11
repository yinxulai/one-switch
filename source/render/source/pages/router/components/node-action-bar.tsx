import { Copy, Trash2 } from 'lucide-react'

import { cn } from '@/lib/utils'

type NodeActionBarProps = {
  /** 节点被选中时始终展示 */
  selected: boolean
  canDuplicate: boolean
  canDelete: boolean
  onDuplicate: () => void
  onDelete: () => void
}

/**
 * 节点悬浮操作条。
 * 结构复制自 Dify `nodes/_base/components/node-control.tsx`，
 * 去掉插件安装锁与帮助入口，只保留复制 / 删除。
 */
export function NodeActionBar(props: NodeActionBarProps) {
  const { selected, canDuplicate, canDelete, onDuplicate, onDelete } = props
  if (!canDuplicate && !canDelete) return null

  return (
    <div
      className={cn(
        'absolute -top-7 right-0 flex h-7 pb-1',
        selected ? 'visible' : 'invisible group-hover/node:visible',
      )}
    >
      {/* 对齐 Dify node-control.tsx 的内层类名：操作条压在节点卡片上，
          亮色下 actionbar 底色与节点底色几乎一致，因此保留 Dify 的 0.5px 描边、省掉 shadow-md。 */}
      <div className="nodrag nopan nowheel flex h-6 items-center rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg px-0.5 text-text-tertiary backdrop-blur-[5px]">
        {canDuplicate && (
          <button
            type="button"
            aria-label="复制节点"
            className="flex size-5 items-center justify-center rounded-md transition-colors hover:bg-state-base-hover hover:text-text-secondary"
            onMouseDown={event => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onDuplicate()
            }}
          >
            <Copy className="size-3" aria-hidden />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            aria-label="删除节点"
            className="flex size-5 items-center justify-center rounded-md transition-colors hover:bg-state-destructive-hover hover:text-text-destructive"
            onMouseDown={event => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="size-3" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
