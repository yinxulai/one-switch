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
  if (!enabled) return <TriangleAlert className="size-3.5 shrink-0 text-text-warning" aria-hidden />

  if (status === 'running') {
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-text-accent" aria-hidden />
  }
  if (status === 'failed') {
    return <CircleAlert className="size-3.5 shrink-0 text-text-destructive" aria-hidden />
  }
  if (status === 'succeeded') {
    return <CircleCheckBig className="size-3.5 shrink-0 text-text-success" aria-hidden />
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
    <div className={cn('px-3 pt-1 pb-2 wrap-break-word whitespace-pre-line system-xs-regular text-text-tertiary', className)}>
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
        <div className="min-w-0 truncate system-2xs-semibold-uppercase text-text-tertiary">{caption}</div>
        <div className="shrink-0 system-xs-semibold text-text-secondary">{label}</div>
      </div>
      {children}
    </div>
  )
}

interface NodeConditionChipProps {
  className?: string
  children: ReactNode
}

/** 条件条目，对应 Dify `nodes/if-else/components/condition-value.tsx` 的圆角浅底容器。
 *  Dify 依赖变量标签自带的最大宽度避免折行；我们改成 `flex-nowrap` + 变量/值两侧截断，
 *  保证条目恒定 24px 单行，不会撑破 `h-6` 的分支行。 */
export function NodeConditionChip(props: NodeConditionChipProps) {
  const { className, children } = props
  return <div className={cn('flex flex-nowrap items-center rounded-md bg-workflow-block-parma-bg', className)}>{children}</div>
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
    <div className={cn('flex h-6 items-center justify-between gap-1 rounded-md bg-workflow-block-parma-bg px-1', className)}>
      <div className="flex w-0 grow items-center gap-1">
        {icon}
        <div className="w-0 grow truncate system-xs-regular text-text-secondary">{name}</div>
      </div>
      {meta && (
        <div className="ml-1 flex shrink-0 items-center gap-1 uppercase system-2xs-regular text-text-tertiary">{meta}</div>
      )}
    </div>
  )
}
