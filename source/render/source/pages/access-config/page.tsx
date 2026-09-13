import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { ProxyToggleButton } from '@/components/proxy-toggle-button'
import { useTranslation } from '@/i18n/provider'
import { ClientAddressStep } from './components/client-address-step'
import { ClientCredentialStep } from './components/client-credential-step'
import { ProxyServiceStep } from './components/proxy-service-step'
import { useAccessConfig } from './hooks/use-access-config'
import { useCopyToClipboard } from './hooks/use-copy-to-clipboard'

/**
 * 接入配置页是一条三步引导：① 确认服务在跑 → ② 选客户端、复制地址 → ③ 补上客户端还要的字段。
 *
 * 页头右侧的启停按钮就是第一步的操作入口（换地址只是第一步里的次要选项），
 * 三步之外不再有复述同样信息的卡片：用户从客户端连不上回来时，只会在其中一步找到答案。
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
        <ProxyServiceStep
          running={config.running}
          host={config.host}
          port={config.port}
          wildcardHost={config.wildcardHost}
        />
        <ClientAddressStep
          origin={config.origin}
          copiedKey={copiedKey}
          onCopy={copy}
        />
        <ClientCredentialStep
          copiedKey={copiedKey}
          onCopy={copy}
        />
      </PageContent>
    </PageLayout>
  )
}
