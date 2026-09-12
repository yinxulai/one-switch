import { cn } from '@/lib/utils'
import { ProviderIcon } from './provider-icon'
import { PROVIDER_PRESETS, type ProviderPreset } from '../lib/provider-presets'

interface ProviderPresetPickerProps {
  providerName: string
  onApplyPreset: (preset: ProviderPreset) => void
}

export function ProviderPresetPicker(props: ProviderPresetPickerProps) {
  const { providerName, onApplyPreset } = props

  return (
    <div className="grid gap-1.5">
      <span className="system-xs-regular text-text-tertiary">快速选择</span>
      <div className="flex flex-wrap gap-2">
        {PROVIDER_PRESETS.map(preset => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onApplyPreset(preset)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border border-module-border bg-workflow-block-parma-bg px-2 py-1 transition-colors',
              'system-xs-medium text-text-secondary hover:bg-state-base-hover-alt hover:text-text-primary',
              providerName === preset.name && 'bg-accent text-text-primary',
            )}
          >
            <span style={{ color: preset.color }}>
              <ProviderIcon name={preset.name} size={18} />
            </span>
            {preset.name}
          </button>
        ))}
      </div>
    </div>
  )
}
