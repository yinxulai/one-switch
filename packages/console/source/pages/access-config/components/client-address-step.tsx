import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { FormRow } from '@/components/form-kit'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTranslation } from '@/i18n/provider'
import { ACCESS_CLIENT_PROFILES, buildBaseUrl, buildEndpointUrl, type AccessClientId } from '../clients'
import { StepCard } from './step-card'

/** 切换顺序固定：OpenAI 兼容在前，Anthropic 在后。 */
const CLIENT_IDS: AccessClientId[] = ['openai', 'anthropic']

const CLIENT_TITLE_KEYS: Record<AccessClientId, UiCatalogKey> = {
  openai: 'access.client.openai.title',
  anthropic: 'access.client.anthropic.title',
}

/** 每个客户端「自己会补哪段路径」的说明，抄地址前先读这一句。 */
const CLIENT_HINT_KEYS: Record<AccessClientId, UiCatalogKey> = {
  openai: 'access.step.address.openaiHint',
  anthropic: 'access.step.address.anthropicHint',
}

interface ClientAddressStepProps {
  /** 代理服务根地址，形如 `http://127.0.0.1:19300`；服务没跑时是空串。 */
  origin: string
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
}

/**
 * 第二步：先选客户端类型，再复制它该填的那条地址。
 *
 * 这一步是整页最容易出错的地方：两类客户端的 Base URL 只差一个 `/v1`，
 * 而客户端又会各自拼接自己的接口路径，所以切换器旁边直接写清「它会补什么」，
 * 完整接口地址退到下面当参照，不让 Base URL 和完整地址混在一起列。
 */
export function ClientAddressStep(props: ClientAddressStepProps) {
  const { origin, copiedKey, onCopy } = props
  const t = useTranslation()
  const [clientId, setClientId] = useState<AccessClientId>('openai')

  const profile = ACCESS_CLIENT_PROFILES[clientId]
  const baseUrl = buildBaseUrl(origin, profile)
  const baseUrlKey = `base-url:${clientId}`

  return (
    <StepCard
      index={2}
      title={t('access.step.address.title')}
      description={t('access.step.address.description')}
    >
      <FormRow
        title={t('access.step.address.client')}
        control={(
          <Tabs value={clientId} onValueChange={value => setClientId(value as AccessClientId)}>
            <TabsList>
              {CLIENT_IDS.map(id => (
                <TabsTrigger key={id} value={id} className="px-2.5 text-xs">
                  {t(CLIENT_TITLE_KEYS[id])}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      />

      {/* Base URL 是这一步的答案：字号最大、只有它带一个实心按钮。 */}
      <div className="grid min-w-0 gap-2 py-4">
        <span className="system-2xs-regular text-text-tertiary">{t('access.step.address.baseUrl')}</span>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate font-mono system-xl-medium text-text-primary select-all">
            {baseUrl || '—'}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!baseUrl}
            aria-label={t('access.step.address.copyBaseUrl')}
            title={t('access.step.address.copyBaseUrl')}
            onClick={() => onCopy(baseUrlKey, baseUrl)}
          >
            {copiedKey === baseUrlKey ? <Check /> : <Copy />}
            {copiedKey === baseUrlKey ? t('common.action.copied') : t('common.action.copy')}
          </Button>
        </div>
        <p className="system-xs-regular text-text-tertiary">{t(CLIENT_HINT_KEYS[clientId])}</p>
      </div>

      <div className="grid min-w-0 gap-2 py-4">
        <span className="system-2xs-regular text-text-tertiary">{t('access.step.address.fullUrl')}</span>
        <p className="system-xs-regular text-text-tertiary">{t('access.step.address.fullUrlHint')}</p>
        <div className="grid min-w-0 gap-1">
          {profile.endpoints.map(endpoint => {
            const url = buildEndpointUrl(origin, endpoint.path)
            const copied = copiedKey === endpoint.key
            const copyLabel = t('access.step.address.copyFullUrl', { protocol: endpoint.name })
            return (
              <div key={endpoint.key} className="flex min-w-0 items-center gap-2">
                <span className="w-32 shrink-0 truncate system-xs-regular text-text-secondary">
                  {endpoint.name}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono system-xs-regular text-text-tertiary select-all">
                  {url || '—'}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={!url}
                  aria-label={copyLabel}
                  title={copyLabel}
                  onClick={() => onCopy(endpoint.key, url)}
                >
                  {copied ? <Check /> : <Copy />}
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    </StepCard>
  )
}
