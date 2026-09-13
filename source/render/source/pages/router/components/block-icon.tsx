import { cn } from '@/lib/utils'

import type { WorkflowNodeKind } from '@common/router/types'
import { kindIcon, kindTone } from '../node-meta'

/**
 * 节点图标块，逐字对齐 Dify `app/components/workflow/block-icon.tsx`：
 * 圆角色块 + 半像素白描边 + 白色图标，底色取自同一份 `util-colors-*-500` 色板
 * （见 `node-meta.ts` 的 NODE_KIND_META.tone）。
 * 尺寸表同样取自 Dify 的 ICON_CONTAINER_CLASSNAME_SIZE_MAP / ICON_CLASSNAME_SIZE_MAP，
 * 但按仓库偏好去掉了 shadow-xs / shadow-md，层次改由色块本身的明度承担。
 */
export type BlockIconSize = 'xs' | 'sm' | 'md'

const ICON_CONTAINER_SIZE_MAP: Record<BlockIconSize, string> = {
  xs: 'size-4 rounded-[5px]',
  sm: 'size-5 rounded-md',
  md: 'size-6 rounded-lg',
}

const ICON_SIZE_MAP: Record<BlockIconSize, string> = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4',
}

interface BlockIconProps {
  kind: WorkflowNodeKind
  size?: BlockIconSize
  className?: string
}

export function BlockIcon(props: BlockIconProps) {
  const { kind, size = 'md', className } = props
  const Icon = kindIcon(kind)

  return (
    <div
      className={cn(
        'flex items-center justify-center border-[0.5px] border-white/2 text-white',
        ICON_CONTAINER_SIZE_MAP[size],
        kindTone(kind),
        className,
      )}
    >
      <Icon className={ICON_SIZE_MAP[size]} />
    </div>
  )
}
