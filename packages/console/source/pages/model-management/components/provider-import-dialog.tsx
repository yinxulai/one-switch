import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGroup, FormHint } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import type { ProviderBundle } from '@common/provider-bundle'

interface ProviderImportDialogProps {
  fileName: string
  bundle: ProviderBundle
  existingProviderNames: string[]
  importing: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function ProviderImportDialog(props: ProviderImportDialogProps) {
  const { fileName, bundle, existingProviderNames, importing, onOpenChange, onConfirm } = props
  const t = useTranslation()
  const existingNames = new Set(existingProviderNames)
  const overrideCount = bundle.providers.filter(provider => existingNames.has(provider.name)).length
  const keyCount = bundle.providers.filter(provider => provider.apiKey !== undefined).length

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('providers.import.title', { count: bundle.providers.length })}</DialogTitle>
          <DialogDescription className="truncate">{t('providers.import.sourceFile', { name: fileName })}</DialogDescription>
        </DialogHeader>

        <FormGroup className="py-1">
          <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {bundle.providers.map(provider => (
              <li key={provider.name} className="flex items-center justify-between gap-2 rounded-lg border border-module-border bg-workflow-block-parma-bg px-2.5 py-1.5">
                <span className="min-w-0 truncate system-xs-medium text-text-primary">{provider.name}</span>
                <span className="shrink-0 system-2xs-regular text-text-tertiary">
                  {t('providers.modelCount', { count: provider.models.length })} · {existingNames.has(provider.name) ? t('providers.import.overwriteEntry') : t('providers.import.createEntry')}
                </span>
              </li>
            ))}
          </ul>

          <FormHint>
            {overrideCount > 0
              ? t('providers.import.overwriteNotice', { count: overrideCount })
              : t('providers.import.createNotice')}
            {keyCount > 0 ? t('providers.import.keysIncluded', { count: keyCount }) : t('providers.import.keysAbsent')}
          </FormHint>

          <FormHint>{t('providers.import.modelBindingHint')}</FormHint>
        </FormGroup>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.action.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={importing}>
            {importing ? t('providers.import.importing') : t('providers.import.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
