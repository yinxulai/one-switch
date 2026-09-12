import type { NodePanelProps } from '../node-data'
import { useTranslation } from '@/i18n/provider'
import { NodePanelHint } from './panel-fields'

export function ProtocolDiscoveryPanel(_props: NodePanelProps) {
  const t = useTranslation()

  return (
    <div className="grid gap-2.5">
      <NodePanelHint>
        {t('router.panel.protocolDiscoveryHint')}
      </NodePanelHint>
      <NodePanelHint>
        {t('router.panel.protocolDiscoveryPortsHint')}
      </NodePanelHint>
    </div>
  )
}
