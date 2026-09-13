import { RefreshCcw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import type { Settings } from '@common/schemas'
import { useTranslation } from '@/i18n/provider'

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
  const t = useTranslation()
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
      error={outOfRange ? t('settings.failover.rangeError', { min, max }) : undefined}
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
  const t = useTranslation()

  return (
    <Card>
      <SettingsCardHeader
        icon={<RefreshCcw />}
        title={t('settings.failover.title')}
        description={t('settings.failover.description')}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <NumberRow
          title={t('settings.failover.threshold')}
          description={t('settings.failover.thresholdDescription')}
          placeholder="3"
          suffix={t('settings.failover.thresholdUnit')}
          min={1}
          max={100}
          value={settings.consecutiveFailureThreshold}
          onChange={value => onUpdate('consecutiveFailureThreshold', value)}
        />
        <NumberRow
          title={t('settings.failover.base')}
          description={t('settings.failover.baseDescription')}
          placeholder="30"
          suffix={t('settings.failover.unitSeconds')}
          min={1}
          max={86400}
          value={settings.cooldownBaseSeconds}
          onChange={value => onUpdate('cooldownBaseSeconds', value)}
        />
        <NumberRow
          title={t('settings.failover.max')}
          description={t('settings.failover.maxDescription')}
          placeholder="300"
          suffix={t('settings.failover.unitSeconds')}
          min={1}
          max={86400}
          value={settings.cooldownMaxSeconds}
          onChange={value => onUpdate('cooldownMaxSeconds', value)}
        />
        <NumberRow
          title={t('settings.failover.timeout')}
          description={t('settings.failover.timeoutDescription')}
          placeholder="30000"
          suffix={t('settings.failover.unitMilliseconds')}
          min={1000}
          max={600000}
          value={settings.idleTimeoutMilliseconds}
          onChange={value => onUpdate('idleTimeoutMilliseconds', value)}
        />
      </CardContent>
    </Card>
  )
}
