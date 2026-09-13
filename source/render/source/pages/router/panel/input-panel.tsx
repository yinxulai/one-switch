import type { NodePanelProps } from '../node-data'
import { useTranslation } from '@/i18n/provider'
import { NodePanelHint } from './panel-fields'

export function InputPanel(_props: NodePanelProps) {
  const t = useTranslation()

  return <NodePanelHint>{t('router.panel.inputNoOptions')}</NodePanelHint>
}
