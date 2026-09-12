import type { ReactNode } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'

interface RowValueProps {
  children: ReactNode
  mono?: boolean
}

interface ClientSetupCardProps {
  onNavigateToModels?: () => void
}

function RowValue(props: RowValueProps) {
  const { children, mono = false } = props
  return <span className={cn('system-xs-regular text-text-secondary', mono && 'font-mono')}>{children}</span>
}

export function ClientSetupCard(props: ClientSetupCardProps) {
  const { onNavigateToModels } = props
  const t = useTranslation()
  return (
    <Card>
      <SettingsCardHeader
        icon={<KeyRound />}
        title={t('access.client.title')}
        description={t('access.client.description')}
      />
      <CardContent className="divide-y divide-border/50">
        <FormRow
          title={t('access.client.modelName.title')}
          description={t('access.client.modelName.description')}
          control={<RowValue mono>default</RowValue>}
        />
        <FormRow
          title={t('access.client.apiKey.title')}
          description={t('access.client.apiKey.description')}
          control={<RowValue>{t('access.client.apiKey.value')}</RowValue>}
        />
        <FormRow
          title={t('access.client.upstream.title')}
          description={t('access.client.upstream.description')}
          control={onNavigateToModels && (
            <Button variant="outline" size="sm" onClick={onNavigateToModels}>{t('access.client.goToModels')}</Button>
          )}
        />
      </CardContent>
    </Card>
  )
}
