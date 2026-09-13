import { KeyRound } from 'lucide-react'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/provider'

interface ProviderFieldsProps {
  editingProviderId: string | null
  providerName: string
  apiKey: string
  timeout: string
  setProviderName: (name: string) => void
  setApiKey: (key: string) => void
  setTimeout: (timeout: string) => void
}

export function ProviderFields(props: ProviderFieldsProps) {
  const { editingProviderId, providerName, apiKey, timeout, setProviderName, setApiKey, setTimeout } = props
  const t = useTranslation()

  return (
    <div className="grid gap-4">
      <FormField label={t('providers.fields.name')} htmlFor="provider-name">
        <Input
          id="provider-name"
          value={providerName}
          onChange={event => setProviderName(event.target.value)}
          placeholder={t('providers.fields.namePlaceholder')}
        />
      </FormField>

      <FormField
        label={t('providers.fields.apiKey')}
        htmlFor="provider-key"
        hint={t('providers.fields.apiKeyHint')}
      >
        <div className="relative">
          <KeyRound aria-hidden className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-text-tertiary" />
          <Input
            id="provider-key"
            type="password"
            className="pl-9"
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
            placeholder={editingProviderId ? t('providers.fields.apiKeyPlaceholderEdit') : t('providers.fields.apiKeyPlaceholderNew')}
          />
        </div>
      </FormField>

      <FormField
        label={t('providers.fields.timeout')}
        htmlFor="provider-timeout"
        hint={t('providers.fields.timeoutHint')}
      >
        <Input
          id="provider-timeout"
          type="number"
          min={1}
          value={timeout}
          onChange={event => setTimeout(event.target.value)}
          placeholder={t('providers.fields.timeoutPlaceholder')}
        />
      </FormField>
    </div>
  )
}
