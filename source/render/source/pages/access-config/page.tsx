import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { ProxyToggleButton } from '@/components/proxy-toggle-button'
import { useTranslation } from '@/i18n/provider'
import { ClientSetupCard } from './components/client-setup-card'
import { ServiceEndpointCard } from './components/service-endpoint-card'
import { useAccessConfig } from './hooks/use-access-config'
import { useCopyToClipboard } from './hooks/use-copy-to-clipboard'

/**
 * 接入配置页只回答两件事：地址是什么（本地代理服务），客户端要填什么（客户端配置）。
 * 这两件事各自只在一张卡里说，页面上不再有第三张复述它们的卡片。
 */
export function AccessConfigPage() {
  const config = useAccessConfig()
  const { copiedKey, copy } = useCopyToClipboard()
  const t = useTranslation()

  return (
    <PageLayout>
      <PageHeader
        title={t('access.title')}
        description={t('access.description')}
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
        />
        <ClientSetupCard
          copiedKey={copiedKey}
          onCopy={copy}
        />
      </PageContent>
    </PageLayout>
  )
}
