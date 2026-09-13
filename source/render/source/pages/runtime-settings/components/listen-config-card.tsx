import { RadioTower } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/provider'

interface ListenConfigCardProps {
  listenHost: string
  listenPort: number
  proxyRunning: boolean
  onHostChange: (value: string) => void
  onPortChange: (value: number) => void
}

export function ListenConfigCard(props: ListenConfigCardProps) {
  const { listenHost, listenPort, proxyRunning, onHostChange, onPortChange } = props
  const t = useTranslation()

  return (
    <Card>
      <SettingsCardHeader
        icon={<RadioTower />}
        title={t('settings.listen.title')}
        description={t('settings.listen.description')}
        actions={(
          <Badge variant={proxyRunning ? 'success' : 'muted'}>
            {proxyRunning ? t('common.state.running') : t('common.state.stopped')}
          </Badge>
        )}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.listen.host')}
          description={t('settings.listen.hostDescription')}
          control={(
            <Input
              id="listen-host"
              aria-label={t('settings.listen.hostAria')}
              className="w-56 font-mono"
              placeholder="127.0.0.1"
              value={listenHost}
              onChange={event => onHostChange(event.target.value)}
            />
          )}
        />
        <FormRow
          title={t('settings.listen.port')}
          description={t('settings.listen.portDescription')}
          control={(
            <Input
              id="listen-port"
              aria-label={t('settings.listen.portAria')}
              className="w-24 text-right"
              max={65535}
              min={1}
              placeholder="9300"
              type="number"
              value={listenPort}
              onChange={event => onPortChange(Number(event.target.value))}
            />
          )}
        />
      </CardContent>
    </Card>
  )
}
