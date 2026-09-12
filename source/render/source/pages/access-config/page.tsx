import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { ProxyToggleButton } from '@/components/proxy-toggle-button'
import { ClientSetupCard } from './components/client-setup-card'
import { QuickStartCard } from './components/quick-start-card'
import { ServiceEndpointCard } from './components/service-endpoint-card'
import { useAccessConfig } from './hooks/use-access-config'
import { useCopyToClipboard } from './hooks/use-copy-to-clipboard'

interface AccessConfigPageProps {
  onNavigateToModels?: () => void
  onNavigateToSettings?: () => void
}

export function AccessConfigPage(props: AccessConfigPageProps) {
  const { onNavigateToModels, onNavigateToSettings } = props
  const config = useAccessConfig()
  const { copiedKey, copy } = useCopyToClipboard()

  return (
    <PageLayout>
      <PageHeader
        title="接入配置"
        description="把本地代理地址填进任意 AI 客户端，即可用统一入口调用全部上游模型"
        actions={<ProxyToggleButton running={config.running} onToggle={config.toggleProxy} />}
      />

      <PageContent>
        <ServiceEndpointCard
          running={config.running}
          host={config.host}
          port={config.port}
          baseUrl={config.baseUrl}
          wildcardHost={config.wildcardHost}
          copiedKey={copiedKey}
          onCopy={copy}
          onNavigateToSettings={onNavigateToSettings}
        />
        <ClientSetupCard onNavigateToModels={onNavigateToModels} />
        <QuickStartCard />
      </PageContent>
    </PageLayout>
  )
}
