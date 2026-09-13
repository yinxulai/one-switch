import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FORM_DIALOG_BODY_CLASSNAME, FormGroup } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import { ProviderEndpointCard } from './provider-endpoint-card'
import { ProviderFields } from './provider-fields'
import type { ProviderEndpointEntry } from '../hooks/types'

interface ProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingProviderId: string | null
  providerName: string
  apiKey: string
  timeout: string
  endpointEntries: ProviderEndpointEntry[]
  saving: boolean
  setProviderName: (name: string) => void
  setApiKey: (key: string) => void
  setTimeout: (timeout: string) => void
  updateEndpointEntry: (index: number, patch: Partial<ProviderEndpointEntry>) => void
  onCancel: () => void
  onSave: () => void
}

export function ProviderDialog(props: ProviderDialogProps) {
  const {
    open,
    onOpenChange,
    editingProviderId,
    providerName,
    apiKey,
    timeout,
    endpointEntries,
    saving,
    setProviderName,
    setApiKey,
    setTimeout,
    updateEndpointEntry,
    onCancel,
    onSave,
  } = props

  const t = useTranslation()
  const canSave = Boolean(providerName.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        onPointerDownOutside={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{editingProviderId ? t('providers.dialog.editTitle') : t('providers.dialog.createTitle')}</DialogTitle>
          <DialogDescription>{t('providers.dialog.apiKeyHint')}</DialogDescription>
        </DialogHeader>

        <div className={FORM_DIALOG_BODY_CLASSNAME}>
          <ProviderFields
            editingProviderId={editingProviderId}
            providerName={providerName}
            apiKey={apiKey}
            timeout={timeout}
            setProviderName={setProviderName}
            setApiKey={setApiKey}
            setTimeout={setTimeout}
          />

          {/* 协议默认地址 */}
          <FormGroup
            title={t('providers.dialog.endpointsTitle')}
            description={t('providers.dialog.endpointsDescription')}
          >
            {endpointEntries.map((entry, index) => (
              <ProviderEndpointCard
                key={entry.protocol}
                entry={entry}
                index={index}
                updateEndpointEntry={updateEndpointEntry}
              />
            ))}
          </FormGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('common.action.cancel')}</Button>
          <Button disabled={saving || !canSave} onClick={onSave}>
            {saving ? t('common.action.saving') : editingProviderId ? t('providers.dialog.save') : t('providers.dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
