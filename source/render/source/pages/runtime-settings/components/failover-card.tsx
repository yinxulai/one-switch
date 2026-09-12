import { RefreshCcw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import type { Settings } from '@common/schemas'

interface FailoverCardProps {
  settings: Pick<Settings, 'consecutiveFailureThreshold' | 'cooldownBaseSeconds' | 'cooldownMaxSeconds' | 'idleTimeoutMilliseconds'>
  onUpdate: <K extends keyof FailoverCardProps['settings']>(key: K, value: Settings[K]) => void
}

type NumberRowProps = {
  title: string
  description: string
  value: number
  suffix: string
  placeholder: string
  min: number
  max: number
  onChange: (value: number) => void
}

/** 带单位后缀的设置行；单位不参与命中区域，避免遮挡输入。 */
function NumberRow(props: NumberRowProps) {
  const { title, description, value, suffix, placeholder, min, max, onChange } = props
  const outOfRange = !Number.isInteger(value) || value < min || value > max

  // 设置项会被直接写入后端，这里就地收敛到合法区间，避免留下 0 / NaN 这类非法值。
  const handleChange = (raw: string) => {
    const parsed = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(parsed)) return
    onChange(Math.min(max, Math.max(min, Math.round(parsed))))
  }

  return (
    <FormRow
      title={title}
      description={description}
      error={outOfRange ? `请输入 ${min} 到 ${max} 之间的整数` : undefined}
      control={(
        <div className="flex items-center gap-2">
          <Input
            aria-label={title}
            aria-invalid={outOfRange}
            className="w-24 text-right font-mono"
            min={min}
            max={max}
            placeholder={placeholder}
            type="number"
            value={Number.isFinite(value) ? value : ''}
            onChange={event => handleChange(event.target.value)}
          />
          <span className="w-8 system-xs-regular text-text-tertiary">{suffix}</span>
        </div>
      )}
    />
  )
}

export function FailoverCard(props: FailoverCardProps) {
  const { settings, onUpdate } = props

  return (
    <Card>
      <SettingsCardHeader icon={<RefreshCcw />} title="故障转移" description="控制失败判定、冷却恢复与流式连接超时" />
      <CardContent className="divide-y divide-border/50 px-4">
        <NumberRow
          title="连续失败阈值"
          description="连续失败达到该次数后，供应商进入冷却"
          placeholder="3"
          suffix="次"
          min={1}
          max={100}
          value={settings.consecutiveFailureThreshold}
          onChange={value => onUpdate('consecutiveFailureThreshold', value)}
        />
        <NumberRow
          title="初始冷却"
          description="首次进入冷却时的等待时长"
          placeholder="30"
          suffix="秒"
          min={1}
          max={86400}
          value={settings.cooldownBaseSeconds}
          onChange={value => onUpdate('cooldownBaseSeconds', value)}
        />
        <NumberRow
          title="最大冷却"
          description="冷却时长随失败次数递增，不超过该上限"
          placeholder="300"
          suffix="秒"
          min={1}
          max={86400}
          value={settings.cooldownMaxSeconds}
          onChange={value => onUpdate('cooldownMaxSeconds', value)}
        />
        <NumberRow
          title="流式空闲超时"
          description="流式响应在该时长内没有新数据时判定为失败"
          placeholder="30000"
          suffix="毫秒"
          min={1000}
          max={600000}
          value={settings.idleTimeoutMilliseconds}
          onChange={value => onUpdate('idleTimeoutMilliseconds', value)}
        />
      </CardContent>
    </Card>
  )
}
