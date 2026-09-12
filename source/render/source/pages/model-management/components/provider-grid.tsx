import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Server } from 'lucide-react'
import { useTranslation } from '@/i18n/provider'
import { ProviderIcon } from './provider-icon'
import { findPresetByName, getBuiltInProviderSuggestions } from '../lib/provider-presets'
import type { ProviderPreset } from '../lib/provider-presets'
import type { Provider, ProviderModelRoute } from '@common/schemas'

interface ProviderGridProps {
  providers: Provider[]
  models: ProviderModelRoute[]
  selectedProviderId: string
  onSelectProvider: (id: string) => void
  onSelectBuiltInProvider: (preset: ProviderPreset) => void
}

interface ProviderGridItem {
  id: string
  name: string
  enabled: boolean
  modelCount: number
  onSelect: () => void
}

export function ProviderGrid(props: ProviderGridProps) {
  const { providers, models, selectedProviderId, onSelectProvider, onSelectBuiltInProvider } = props
  const t = useTranslation()
  const builtinSuggestions = getBuiltInProviderSuggestions(providers.map(provider => provider.name))

  const renderItem = (item: ProviderGridItem) => {
    const active = selectedProviderId === item.id
    const preset = findPresetByName(item.name)
    const iconColor = preset?.color

    return (
      <button
        key={item.id}
        onClick={item.onSelect}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition-colors',
          active
            ? 'bg-accent text-text-primary'
            : 'text-text-secondary hover:bg-state-base-hover hover:text-text-primary',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-lg"
            style={{
              color: iconColor ?? 'var(--primary)',
              backgroundColor: iconColor ? `${iconColor}14` : 'color-mix(in srgb, var(--primary) 10%, transparent)',
            }}
          >
            <ProviderIcon name={item.name} size={21} />
          </span>
          <div className="flex min-w-0 flex-1 items-baseline gap-1">
            <span className="min-w-0 truncate system-xs-medium text-text-primary">{item.name}</span>
            <span className="shrink-0 system-2xs-regular text-text-tertiary">{t('providers.modelCount', { count: item.modelCount })}</span>
          </div>
        </div>
        {!item.enabled && (
          <Badge variant="muted" className="shrink-0 system-2xs-medium">
            {t('common.state.disabled')}
          </Badge>
        )}
      </button>
    )
  }

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle>{t('providers.grid.title')}</CardTitle>
        <CardDescription>
          {t('providers.grid.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {providers.length || builtinSuggestions.length ? (
          <div className="px-2 pb-2">
            {providers.map(provider => {
              const modelCount = new Set(
                models.filter(model => model.providerId === provider.id).map(model => model.modelName),
              ).size
              return renderItem({
                id: provider.id,
                name: provider.name,
                enabled: provider.enabled,
                modelCount,
                onSelect: () => onSelectProvider(provider.id),
              })
            })}

            {builtinSuggestions.map(preset => renderItem({
              id: `builtin-${preset.key}`,
              name: preset.name,
              enabled: true,
              modelCount: 0,
              onSelect: () => onSelectBuiltInProvider(preset),
            }))}
          </div>
        ) : (
          <EmptyState
            icon={Server}
            title={t('providers.empty.noneTitle')}
            description={t('providers.grid.emptyDescription')}
            className="min-h-36 py-6"
            embedded
          />
        )}
      </CardContent>
    </Card>
  )
}
