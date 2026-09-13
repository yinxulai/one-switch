import { cn } from '@/lib/utils'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/provider'
import { ProtocolUrlHint } from './protocol-url-hint'
import { PROTOCOL_PLACEHOLDERS, PROTOCOL_OPTIONS } from '../lib/protocols'
import type { ProviderEndpointEntry } from '../hooks/types'

interface ProviderEndpointCardProps {
  entry: ProviderEndpointEntry
  index: number
  updateEndpointEntry: (index: number, patch: Partial<ProviderEndpointEntry>) => void
}

export function ProviderEndpointCard(props: ProviderEndpointCardProps) {
  const { entry, index, updateEndpointEntry } = props
  const t = useTranslation()
  const label = PROTOCOL_OPTIONS.find(option => option.value === entry.protocol)?.label

  return (
    <div className={cn('grid gap-3 rounded-lg border border-module-border bg-workflow-block-parma-bg p-3 transition-opacity', !entry.enabled && 'opacity-60')}>
      <div className="flex items-center justify-between gap-3">
        <span className="system-sm-medium text-text-primary">{label}</span>
        <div className="flex items-center gap-2">
          <span className="system-xs-regular text-text-tertiary">{entry.enabled ? t('providers.endpoint.configured') : t('providers.endpoint.notConfigured')}</span>
          <Switch
            checked={entry.enabled}
            onCheckedChange={checked => updateEndpointEntry(index, { enabled: checked })}
          />
        </div>
      </div>

      {entry.enabled && (
        <div className="grid gap-3">
          <FormField label={t('providers.endpoint.urlLabel')} htmlFor={`provider-endpoint-url-${index}`}>
            <Input
              id={`provider-endpoint-url-${index}`}
              type="url"
              className="font-mono"
              value={entry.url}
              onChange={event => updateEndpointEntry(index, { url: event.target.value })}
              placeholder={PROTOCOL_PLACEHOLDERS[entry.protocol]}
            />
          </FormField>
          <ProtocolUrlHint protocol={entry.protocol} />
        </div>
      )}
    </div>
  )
}
