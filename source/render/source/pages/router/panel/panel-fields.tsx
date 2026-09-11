import type { ReactNode } from 'react'

import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** 浮层面板外观，复制自 Dify `packages/dify-ui/src/overlay-shared.ts` 的 `menuPopupSurfaceClassName`。
   *  `workflow-dify-surface` 用于在浮层（被 portal 到 body）内还原 Dify 的圆角刻度。 */
  export const PANEL_POPUP_SURFACE_CLASSNAME =
    'workflow-dify-surface rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 ring-0 shadow-none backdrop-blur-[5px] focus:ring-0 focus:shadow-none'

/** 浮层菜单项，复制自 Dify `overlay-shared.ts` 的 `menuItemClassName`。 */
export const PANEL_POPUP_ITEM_CLASSNAME =
  'mx-1 h-8 gap-1 rounded-lg px-2 text-[13px] leading-4 text-text-secondary focus:bg-state-base-hover focus:text-text-primary not-data-[variant=destructive]:focus:**:text-text-primary'

type NodePanelHintProps = {
  children: ReactNode
  tone?: 'muted' | 'warning'
}

/** 面板里的说明条。 */
export function NodePanelHint(props: NodePanelHintProps) {
  const { children, tone = 'muted' } = props

  return (
    <div
      className={cn(
        'rounded-lg px-2.5 py-2 system-xs-regular',
        tone === 'warning'
          ? 'bg-state-warning-hover text-text-warning'
          : 'bg-workflow-block-parma-bg text-text-tertiary',
      )}
    >
      {children}
    </div>
  )
}

type NodePanelCardProps = {
  children: ReactNode
  className?: string
}

/** 面板里的分组卡片。 */
export function NodePanelCard(props: NodePanelCardProps) {
  const { children, className } = props
  return <div className={cn('grid gap-2.5 rounded-lg bg-workflow-block-parma-bg p-2.5', className)}>{children}</div>
}

type NodePanelFieldProps = {
  label: string
  children: ReactNode
  className?: string
}

/** 面板里的表单项。 */
export function NodePanelField(props: NodePanelFieldProps) {
  const { label, children, className } = props

  return (
    <div className={cn('grid gap-1.5', className)}>
      {/* 不用 shadcn Label：它的 `text-sm leading-none` 会盖过 Dify 的 system-sm-medium。 */}
      <label className="w-fit py-1 system-sm-medium text-text-secondary">{label}</label>
      {children}
    </div>
  )
}

type NodePanelSwitchRowProps = {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/** 面板里的「开关 + 说明」行。 */
export function NodePanelSwitchRow(props: NodePanelSwitchRowProps) {
  const { label, checked, onCheckedChange } = props

  return (
    <div className="flex items-center justify-between rounded-lg bg-workflow-block-parma-bg px-2.5 py-2">
      <span className="system-xs-regular text-text-secondary">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

type NodePanelGroupHeaderProps = {
  title: string
  action?: ReactNode
}

/** 分组标题行（标题 + 右侧操作）。 */
export function NodePanelGroupHeader(props: NodePanelGroupHeaderProps) {
  const { title, action } = props

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="py-1 system-sm-medium text-text-secondary">{title}</span>
      {action}
    </div>
  )
}
