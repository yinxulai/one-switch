import { MonitorCog } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow, FormSelect, type FormOption } from '@/components/form-kit'
import { Switch } from '@/components/ui/switch'
import type { ThemeMode } from '@/components/app-sidebar'

interface GeneralCardProps {
  autoLaunch: boolean
  onAutoLaunchChange: (enabled: boolean) => void
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}

const THEME_OPTIONS: FormOption[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
]

export function GeneralCard(props: GeneralCardProps) {
  const { autoLaunch, onAutoLaunchChange, themeMode, onThemeModeChange } = props

  return (
    <Card>
      <SettingsCardHeader icon={<MonitorCog />} title="外观与启动" description="个性化应用显示和启动行为" />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title="主题"
          description="选择应用的颜色主题"
          control={(
            <FormSelect
              ariaLabel="主题模式"
              className="w-32"
              options={THEME_OPTIONS}
              value={themeMode}
              onValueChange={value => onThemeModeChange(value as ThemeMode)}
            />
          )}
        />
        <FormRow
          title="开机自启"
          description="登录系统时自动启动并隐藏到托盘"
          control={<Switch checked={autoLaunch} onCheckedChange={onAutoLaunchChange} />}
        />
      </CardContent>
    </Card>
  )
}
