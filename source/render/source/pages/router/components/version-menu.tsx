import { ChevronDown, History } from 'lucide-react'

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

import { formatVersionTime, type RouterGraphVersion } from '../graph-versions'
import { PANEL_POPUP_SURFACE_CLASSNAME } from '../panel/panel-fields'
import { DifyButton } from './dify-button'

type VersionMenuProps = {
  versions: RouterGraphVersion[]
  onRestore: (version: RouterGraphVersion) => void
}

/**
 * 「保存」右侧的历史版本下拉。
 *
 * 每次保存都会生成一个新版本（见 `graph-versions.ts`），这里列出所有版本并支持随时回到其中之一。
 * 浮层被 portal 到 body，因此复用 `PANEL_POPUP_SURFACE_CLASSNAME` 自带 `workflow-dify-surface`
 * 圆角还原标记，并按仓库偏好去掉阴影与描边。
 */
export function VersionMenu(props: VersionMenuProps) {
  const { versions, onRestore } = props
  const t = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <DifyButton size="medium" variant="primary" aria-label={t('router.version.aria')} className="w-8 justify-center px-0">
          <ChevronDown className="size-3.5" aria-hidden />
        </DifyButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className={cn(PANEL_POPUP_SURFACE_CLASSNAME, 'w-72 min-w-72')}
      >
        <DropdownMenuLabel className="flex items-center gap-1.5 px-2 py-1.5 system-xs-medium text-text-tertiary">
          <History className="size-3.5" aria-hidden />
          {t('router.version.title')}
          <span className="ml-auto system-2xs-regular text-text-quaternary">{t('router.version.count', { count: versions.length })}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-components-panel-border" />

        {!versions.length && (
          <div className="px-2 py-3 system-xs-regular text-text-tertiary">
            {t('router.version.empty')}
          </div>
        )}

        {versions.map(version => (
          <DropdownMenuItem
            key={version.id}
            onSelect={() => onRestore(version)}
            className="flex h-auto flex-col items-stretch gap-0.5 rounded-lg px-2 py-1.5 focus:bg-state-base-hover"
          >
            <span className="flex items-center gap-2">
              <span className="system-xs-medium text-text-primary">{`v${version.sequence}`}</span>
              <span className="ml-auto font-mono system-2xs-regular text-text-quaternary">
                {formatVersionTime(version.savedAt)}
              </span>
            </span>
            <span className="system-2xs-regular text-text-tertiary">
              {t('router.version.itemHint', { count: version.nodeCount })}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
