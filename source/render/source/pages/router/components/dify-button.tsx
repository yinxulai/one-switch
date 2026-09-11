import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/** Dify 按钮的变体名，只保留本仓库用到的几个。 */
export type DifyButtonVariant = 'primary' | 'secondary' | 'ghost' | 'ghost-destructive'
/** Dify 按钮的尺寸，`small` 用于面板内的次级操作。 */
export type DifyButtonSize = 'small' | 'medium'

const SIZE_CLASSNAME: Record<DifyButtonSize, string> = {
  small: 'h-6 gap-1 rounded-md px-2.25 text-xs font-medium',
  medium: 'h-8 gap-1 rounded-lg px-3.5 text-[13px] leading-4 font-medium',
}

const VARIANT_CLASSNAME: Record<DifyButtonVariant, string> = {
  primary: 'bg-components-button-primary-bg text-components-button-primary-text inset-ring-[0.5px] inset-ring-components-button-primary-border hover:bg-components-button-primary-bg-hover',
  secondary: 'bg-components-button-secondary-bg text-components-button-secondary-text inset-ring-[0.5px] inset-ring-components-button-secondary-border hover:bg-components-button-secondary-bg-hover hover:inset-ring-components-button-secondary-border-hover',
  ghost: 'text-components-button-ghost-text hover:bg-components-button-ghost-bg-hover',
  'ghost-destructive': 'text-components-button-destructive-ghost-text hover:bg-components-button-destructive-ghost-bg-hover',
}

type DifyButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: DifyButtonVariant
  size?: DifyButtonSize
}

/**
 * Dify 风格按钮。
 * 类名逐字复制自 `packages/dify-ui/src/button/index.tsx` 的 `buttonVariants`，
 * 只保留 primary / secondary / ghost / ghost-destructive 四个变体与 small / medium 两个尺寸，
 * 阴影按本仓库偏好换成 `inset-ring` 描边。
 */
export function DifyButton(props: DifyButtonProps) {
  const { variant = 'secondary', size = 'small', className, ...rest } = props

  return (
    <button
      type="button"
      className={cn(
        'inline-flex w-fit cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-text-disabled disabled:inset-ring-transparent',
        SIZE_CLASSNAME[size],
        VARIANT_CLASSNAME[variant],
        className,
      )}
      {...rest}
    />
  )
}
