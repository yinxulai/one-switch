import type { ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

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
        'rounded-lg px-2.5 py-2 text-[11px] leading-4',
        tone === 'warning' ? 'bg-warning/14 text-warning' : 'bg-muted/45 text-muted-foreground',
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
  return <div className={cn('grid gap-2.5 rounded-lg bg-muted/35 p-2.5', className)}>{children}</div>
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
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
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
    <div className="flex items-center justify-between rounded-lg bg-muted/45 px-2.5 py-2">
      <span className="text-xs">{label}</span>
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
      <span className="text-xs font-medium">{title}</span>
      {action}
    </div>
  )
}
