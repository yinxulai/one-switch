import { cn } from '@/lib/utils'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/provider'
import { ProtocolConversionSettings } from './protocol-conversion-settings'
import { ProtocolUrlHint } from './protocol-url-hint'
import { PROTOCOL_PLACEHOLDERS, PROTOCOL_OPTIONS } from '../lib/protocols'
import type { ProtocolEndpointEntry } from '../hooks/types'

interface ModelProtocolEndpointCardProps {
  entry: ProtocolEndpointEntry
  index: number
  updateProtocolEntry: (index: number, patch: Partial<ProtocolEndpointEntry>) => void
}

export function ModelProtocolEndpointCard(props: ModelProtocolEndpointCardProps) {
  const { entry, index, updateProtocolEntry } = props
  const t = useTranslation()
  const label = PROTOCOL_OPTIONS.find(option => option.value === entry.protocol)?.label

  return (
    <div className={cn('grid gap-3 rounded-lg border border-module-border bg-workflow-block-parma-bg p-3 transition-opacity', !entry.enabled && 'opacity-60')}>
      <div className="flex items-center justify-between gap-3">
        <span className="system-sm-medium text-text-primary">{label}</span>
        <div className="flex items-center gap-2">
          <span className="system-xs-regular text-text-tertiary">{entry.enabled ? t('models.endpoint.enabled') : t('models.endpoint.disabled')}</span>
          <Switch
            checked={entry.enabled}
            onCheckedChange={checked => updateProtocolEntry(index, { enabled: checked })}
          />
        </div>
      </div>

      {entry.enabled && (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="system-xs-regular text-text-tertiary">
              {entry.overrideUrl ? t('models.endpoint.useCustomUrl') : t('models.endpoint.useProviderDefault')}
            </span>
            <Switch
              checked={entry.overrideUrl}
              onCheckedChange={checked => updateProtocolEntry(index, { overrideUrl: checked })}
            />
          </div>

          {entry.overrideUrl && (
            <>
              <FormField label={t('providers.endpoint.urlLabel')} htmlFor={`model-endpoint-url-${index}`}>
                <Input
                  id={`model-endpoint-url-${index}`}
                  type="url"
                  className="font-mono"
                  value={entry.endpointUrl}
                  onChange={event => updateProtocolEntry(index, { endpointUrl: event.target.value })}
                  placeholder={PROTOCOL_PLACEHOLDERS[entry.protocol]}
                />
              </FormField>
              <ProtocolUrlHint protocol={entry.protocol} />
            </>
          )}

          <ProtocolConversionSettings
            entry={entry}
            index={index}
            updateProtocolEntry={updateProtocolEntry}
          />
        </div>
      )}
    </div>
  )
}
