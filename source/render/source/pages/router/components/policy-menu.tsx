import { ChevronDown, Sparkles } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'

import { ROUTER_POLICY_PRESETS, type RouterPolicyPreset } from '@common/router/presets'
import { PANEL_POPUP_SURFACE_CLASSNAME } from '../panel/panel-fields'
import { policyPresetTextKeys } from '../policy-preset-text'
import { WorkflowButton } from './workflow-button'

type PolicyMenuProps = {
  /** 当前画布与某个预设一致时高亮它；不一致时为 `null`。 */
  activePolicyId: string | null
  onApply: (preset: RouterPolicyPreset) => void
}

/**
 * 策略下拉：随时把画布换成内置策略，第一项是系统默认策略。
 *
 * 与 `VersionMenu` 同一套浮层样式（去阴影、去描边、复用圆角还原标记）。
 */
export function PolicyMenu(props: PolicyMenuProps) {
  const { activePolicyId, onApply } = props
  const t = useTranslation()
  const activePresetId = activePolicyId ? policyPresetTextKeys(activePolicyId) : undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <WorkflowButton size="medium" aria-label={t('router.policy.aria')}>
          <Sparkles className="size-3.5" aria-hidden />
          {activePresetId ? t(activePresetId.name) : t('router.policy.fallbackName')}
          <ChevronDown className="size-3.5" aria-hidden />
        </WorkflowButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className={cn(PANEL_POPUP_SURFACE_CLASSNAME, 'w-80 min-w-80')}
      >
        <DropdownMenuLabel className="flex items-center gap-1.5 px-2 py-1.5 system-xs-medium text-text-tertiary">
          <Sparkles className="size-3.5" aria-hidden />
          {t('router.policy.title')}
          <span className="ml-auto system-2xs-regular text-text-quaternary">{t('router.policy.subtitle')}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-components-panel-border" />

        {ROUTER_POLICY_PRESETS.map(preset => {
          const textKeys = policyPresetTextKeys(preset.id)
          return (
            <DropdownMenuItem
              key={preset.id}
              onSelect={() => onApply(preset)}
              className="flex h-auto flex-col items-stretch gap-0.5 rounded-lg px-2 py-1.5 focus:bg-state-base-hover"
            >
              <span className="flex items-center gap-2">
                <span className="system-xs-medium text-text-primary">{textKeys ? t(textKeys.name) : preset.id}</span>
                {preset.isDefault && (
                  <span className="rounded-md bg-workflow-block-parma-bg px-1 py-0.5 system-2xs-regular text-text-tertiary">
                    {t('router.policy.builtInDefault')}
                  </span>
                )}
                {preset.id === activePolicyId && (
                  <span className="ml-auto system-2xs-regular text-text-accent">{t('router.policy.current')}</span>
                )}
              </span>
              <span className="system-2xs-regular text-text-tertiary">{textKeys ? t(textKeys.description) : ''}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
