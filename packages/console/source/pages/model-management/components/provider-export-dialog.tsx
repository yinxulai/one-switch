import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGroup, FormHint } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import type { ProviderExportScope } from '../hooks/types'

interface ProviderExportDialogProps {
  scope: ProviderExportScope
  includeApiKeys: boolean
  exporting: boolean
  onIncludeApiKeysChange: (value: boolean) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function ProviderExportDialog(props: ProviderExportDialogProps) {
  const { scope, includeApiKeys, exporting, onIncludeApiKeysChange, onOpenChange, onConfirm } = props
  const t = useTranslation()
  const providerName = scope.kind === 'provider' ? scope.provider.name : null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{providerName ? t('providers.export.titleSingle', { name: providerName }) : t('providers.export.titleAll')}</DialogTitle>
          <DialogDescription>
            {t('providers.export.description')}
          </DialogDescription>
        </DialogHeader>

        <FormGroup className="py-1">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-module-border bg-workflow-block-parma-bg p-3">
            <Checkbox
              checked={includeApiKeys}
              onCheckedChange={value => onIncludeApiKeysChange(value === true)}
              className="mt-0.5"
            />
            <span>
              <span className="block system-xs-medium text-text-primary">{t('providers.export.includeKeys')}</span>
              <span className="mt-1 block system-xs-regular text-text-tertiary">
                {t('providers.export.includeKeysHint')}
              </span>
            </span>
          </label>

          <FormHint>
            {t('providers.export.overwriteHint')}
          </FormHint>
        </FormGroup>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.action.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={exporting}>
            {exporting ? t('providers.export.exporting') : t('providers.action.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
