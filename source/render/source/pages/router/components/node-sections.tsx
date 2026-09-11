import type { ReactNode } from 'react'
import { CircleAlert, CircleCheckBig, LoaderCircle, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { NodeRunStatus } from '../node-data'
import type { WorkflowNodeModel } from '../types'

type NodeHeaderMetaProps = {
  status: NodeRunStatus
  /** 节点被禁用时不展示运行状态 */
  enabled: boolean
}

/** 标题行右侧的状态标记（复制自 Dify `nodes/_base/node-sections.tsx` 的 NodeHeaderMeta）。 */
export function NodeHeaderMeta(props: NodeHeaderMetaProps) {
  const { status, enabled } = props
  if (!enabled) return <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />

  if (status === 'running') {
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-info" aria-hidden />
  }
  if (status === 'failed') {
    return <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />
  }
  if (status === 'succeeded') {
    return <CircleCheckBig className="size-3.5 shrink-0 text-success" aria-hidden />
  }
  return null
}

type NodeDescriptionProps = {
  model: WorkflowNodeModel
  className?: string
}

/** 节点描述，类名对齐 Dify 的 `px-3 pt-1 pb-2 system-xs-regular wrap-break-word whitespace-pre-line text-text-tertiary`。 */
export function NodeDescription(props: NodeDescriptionProps) {
  const { model, className } = props
  if (!model.description) return null

  return (
    <div className={cn('px-3 pt-1 pb-2 text-xs font-normal wrap-break-word whitespace-pre-line text-muted-foreground/70', className)}>
      {model.description}
    </div>
  )
}

interface NodeBodyProps {
  className?: string
  children: ReactNode
}

/** 节点主体容器，对应 Dify 各节点视图里的 `px-3` 包裹层。 */
export function NodeBody(props: NodeBodyProps) {
  const { className, children } = props
  return <div className={cn('px-3', className)}>{children}</div>
}

/** 主体内的行列表，对应 Dify `space-y-0.5`。 */
export function NodeRowList(props: NodeBodyProps) {
  const { className, children } = props
  return <div className={cn('space-y-0.5', className)}>{children}</div>
}

interface NodeBranchRowProps {
  /** 右侧分支关键字，对应 Dify if-else 的 IF / ELIF / ELSE */
  label: string
  /** 左侧小字说明，对应 Dify if-else 的 CASE n */
  caption?: string
  className?: string
  /** 行尾的分支端口 */
  children?: ReactNode
}

/**
 * 分支行，结构逐行对齐 Dify `nodes/if-else/node.tsx`：
 * `relative flex h-6 items-center px-1` + 内层 `justify-between`，端口挂在行尾。
 */
export function NodeBranchRow(props: NodeBranchRowProps) {
  const { label, caption, className, children } = props

  return (
    <div className={cn('relative flex h-6 items-center px-1', className)}>
      <div className="flex w-full items-center justify-between">
        <div className="min-w-0 truncate text-[10px] font-semibold text-muted-foreground/70">{caption}</div>
        <div className="shrink-0 text-[12px] font-semibold text-muted-foreground">{label}</div>
      </div>
      {children}
    </div>
  )
}

interface NodeConditionChipProps {
  className?: string
  children: ReactNode
}

/** 条件条目，对应 Dify `nodes/if-else/components/condition-value.tsx` 的圆角浅底容器。 */
export function NodeConditionChip(props: NodeConditionChipProps) {
  const { className, children } = props
  return <div className={cn('flex flex-wrap items-center rounded-md bg-muted', className)}>{children}</div>
}

interface NodeRowProps {
  className?: string
  /** 行首图标 */
  icon?: ReactNode
  /** 主文案 */
  name: ReactNode
  /** 右侧补充信息 */
  meta?: ReactNode
}

/** 主体内的信息行，对齐 Dify `nodes/start/node.tsx` 的行结构（h-6 圆角浅底）。 */
export function NodeRow(props: NodeRowProps) {
  const { className, icon, name, meta } = props

  return (
    <div className={cn('flex h-6 items-center justify-between gap-1 rounded-md bg-muted px-1', className)}>
      <div className="flex w-0 grow items-center gap-1">
        {icon}
        <div className="w-0 grow truncate text-xs text-muted-foreground">{name}</div>
      </div>
      {meta && <div className="ml-1 flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/70 uppercase">{meta}</div>}
    </div>
  )
}
