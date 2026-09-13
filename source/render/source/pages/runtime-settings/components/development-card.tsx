import { Database } from 'lucide-react'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'

interface DevelopmentCardProps {
  onSeedDevelopment: () => void
}

export function DevelopmentCard(props: DevelopmentCardProps) {
  const t = useTranslation()

  return (
    <Card>
      <SettingsCardHeader icon={<Database />} title={t('settings.development.title')} description={t('settings.development.description')} />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.development.seed')}
          description={t('settings.development.seedDescription')}
          control={(
            <Button variant="secondary" onClick={props.onSeedDevelopment}>
              <Database className="size-3.5" />
              {t('settings.development.seedAction')}
            </Button>
          )}
        />
      </CardContent>
    </Card>
  )
}
