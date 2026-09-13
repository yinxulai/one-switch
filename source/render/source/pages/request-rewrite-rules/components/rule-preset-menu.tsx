import { ChevronDown, FilePlus2, Plus, Wand2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/provider'

import { RULE_PRESETS, type RulePreset } from '../rule-presets'

type RulePresetMenuProps = {
  onCreateBlank: () => void
  onCreateFromPreset: (preset: RulePreset) => void
}

/**
 * 「新建规则」下拉：空白规则 + 内置模板。
 *
 * 与智能路由的策略下拉同一个交互（`pages/router/components/policy-menu.tsx`）：先给用户一个**起点**，
 * 而不是丢一张空表让他自己想「该填什么」。区别是模板只把草稿填好，仍然要用户自己点保存 ——
 * 规则在没有保存前不会对任何流量生效。
 */
export function RulePresetMenu(props: RulePresetMenuProps) {
  const { onCreateBlank, onCreateFromPreset } = props
  const t = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button">
          <Plus /> {t('rules.create')} <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-80 min-w-80">
        <DropdownMenuLabel className="flex items-center gap-1.5 px-2 py-1.5 system-xs-medium text-text-tertiary">
          <Wand2 className="size-3.5" aria-hidden />
          {t('rules.presets.title')}
          <span className="ml-auto system-2xs-regular text-text-quaternary">{t('rules.presets.subtitle')}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-components-panel-border" />

        <DropdownMenuItem
          onSelect={onCreateBlank}
          className="flex h-auto flex-col items-stretch gap-0.5 rounded-lg px-2 py-1.5 focus:bg-state-base-hover"
        >
          <span className="flex items-center gap-1.5 system-xs-medium text-text-primary">
            <FilePlus2 className="size-3.5 text-text-tertiary" aria-hidden />
            {t('rules.presets.blank.name')}
          </span>
          <span className="system-2xs-regular text-text-tertiary">{t('rules.presets.blank.description')}</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-components-panel-border" />

        {RULE_PRESETS.map(preset => (
          <DropdownMenuItem
            key={preset.id}
            onSelect={() => onCreateFromPreset(preset)}
            className="flex h-auto flex-col items-stretch gap-0.5 rounded-lg px-2 py-1.5 focus:bg-state-base-hover"
          >
            <span className="system-xs-medium text-text-primary">{t(preset.nameKey)}</span>
            <span className="system-2xs-regular text-text-tertiary">{t(preset.descriptionKey)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
