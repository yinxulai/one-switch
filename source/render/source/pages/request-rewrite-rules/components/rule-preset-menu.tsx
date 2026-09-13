import { ChevronDown, FilePlus2, Plus, Wand2 } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
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
      {/*
        * 这里**刻意不**用 `asChild` 去包 shadcn 的 `Button`。
        * `components/ui/*` 是 React 19 风格的普通函数组件（不 forwardRef），而本项目跑在 React 18 上：
        * `ref` 会被 React 从 props 里摘走、函数组件又接不到第二个参数，触发器的 ref 落不到真实 DOM 上，
        * Radix 拿不到浮层锚点 → `isPositioned` 永远为 false → 内容被 `translate(0, -200%)` 挪到视口外，
        * 表现就是「点按钮没反应」。
        * 把按钮类名交给 Radix、让它渲染自己的 `<button>`，ref 才一定生效
        * （同 `pages/router/components/dify-button.tsx` 里关于 forwardRef 的说明）。
        */}
      <DropdownMenuTrigger className={cn(buttonVariants())}>
        <Plus aria-hidden />
        {t('rules.create')}
        <ChevronDown className="size-3.5 opacity-60" aria-hidden />
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
