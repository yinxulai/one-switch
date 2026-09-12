import { Pause } from 'lucide-react'
import { InteractiveHoverButton } from '@/components/ui/interactive-hover-button'
import { useTranslation } from '@/i18n/provider'

interface ProxyToggleButtonProps {
  running: boolean
  onToggle: () => void | Promise<void>
}

export function ProxyToggleButton(props: ProxyToggleButtonProps) {
  const { running, onToggle } = props
  const t = useTranslation()

  return (
    <InteractiveHoverButton
      hoverContent={running ? (
        <>
          <span>{t('proxy.toggle.pause')}</span>
          <Pause className="size-3 fill-current" />
        </>
      ) : undefined}
      aria-label={running ? t('proxy.toggle.pause') : t('proxy.toggle.start')}
      title={running ? t('proxy.toggle.pauseTitle') : t('proxy.toggle.startTitle')}
      onClick={() => void onToggle()}
    >
      {running ? t('proxy.toggle.running') : t('proxy.toggle.start')}
    </InteractiveHoverButton>
  )
}
