import { ListOrdered } from 'lucide-react'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation } from '@/i18n/provider'

interface QuickStartStep {
  titleKey: UiCatalogKey
  descriptionKey: UiCatalogKey
}

const STEPS: QuickStartStep[] = [
  { titleKey: 'access.quickStart.copy.title', descriptionKey: 'access.quickStart.copy.description' },
  { titleKey: 'access.quickStart.paste.title', descriptionKey: 'access.quickStart.paste.description' },
  { titleKey: 'access.quickStart.credentials.title', descriptionKey: 'access.quickStart.credentials.description' },
]

export function QuickStartCard() {
  const t = useTranslation()
  return (
    <Card>
      <SettingsCardHeader icon={<ListOrdered />} title={t('access.quickStart.title')} description={t('access.quickStart.description')} />
      <CardContent className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <div key={step.titleKey} className="flex gap-2.5">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 system-2xs-medium text-primary">{index + 1}</span>
            <div className="min-w-0">
              <p className="system-sm-medium text-text-primary">{t(step.titleKey)}</p>
              <p className="mt-0.5 system-xs-regular text-text-tertiary">{t(step.descriptionKey)}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
