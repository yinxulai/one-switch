import type { ReactNode } from 'react'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Card, CardContent } from '@/components/ui/card'

interface StepCardProps {
  /** 步骤序号，1 起数。 */
  index: number
  title: ReactNode
  description?: ReactNode
  /** 卡片头右侧：这一步的状态徽标或快捷动作。 */
  actions?: ReactNode
  children: ReactNode
}

/**
 * 接入配置页的一步。
 *
 * 卡片头本来放图标的位置换成步骤序号：这一页用户读的是顺序（先确认服务、再选客户端、最后补字段），
 * 不是模块身份。序号是内容不是装饰，所以直接写在卡片头里，而不是另起一条时间轴导航。
 * 行的分隔沿用设置页的规矩：`divide-y` 拆行，行内不放图标。
 */
export function StepCard(props: StepCardProps) {
  const { index, title, description, actions, children } = props
  return (
    <Card>
      <SettingsCardHeader
        icon={(
          <span className="flex size-5 items-center justify-center rounded-md bg-inset system-2xs-medium text-text-secondary tabular-nums">
            {index}
          </span>
        )}
        title={title}
        description={description}
        actions={actions}
      />
      <CardContent className="divide-y divide-border/50">
        {children}
      </CardContent>
    </Card>
  )
}
