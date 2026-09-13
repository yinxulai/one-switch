import { Check, Copy, KeyRound } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation } from '@/i18n/provider'
import { routePaths } from '@/routes'

/**
 * 客户端强制要求填写、但本地服务并不校验的两个值。
 *
 * 这两个值是「可以直接粘进客户端」的样例：模型名会命中 `default` 逻辑模型，
 * API Key 只要非空即可（本地服务不鉴权）。给样例就能省掉用户当场编一个值。
 */
const SAMPLE_MODEL_NAME = 'default'
const SAMPLE_API_KEY = 'sk-one-switch'

interface CopyableValueProps {
  value: string
  copied: boolean
  onCopy: () => void
}

interface ClientSetupCardProps {
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
}

/** 可复制的样例值：等宽文本 + 就地复制按钮，反馈留在按钮上。 */
function CopyableValue(props: CopyableValueProps) {
  const { value, copied, onCopy } = props
  const t = useTranslation()
  const label = copied ? t('common.action.copied') : t('common.action.copy')
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono system-xs-regular text-text-secondary select-all">{value}</span>
      <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onCopy}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}

export function ClientSetupCard(props: ClientSetupCardProps) {
  const { copiedKey, onCopy } = props
  const navigate = useNavigate()
  const t = useTranslation()
  return (
    <Card>
      <SettingsCardHeader
        icon={<KeyRound />}
        title={t('access.client.title')}
        description={t('access.client.description')}
      />
      <CardContent className="divide-y divide-border/50">
        <FormRow
          title={t('access.client.modelName.title')}
          description={t('access.client.modelName.description')}
          control={(
            <CopyableValue
              value={SAMPLE_MODEL_NAME}
              copied={copiedKey === 'client-model-name'}
              onCopy={() => onCopy('client-model-name', SAMPLE_MODEL_NAME)}
            />
          )}
        />
        <FormRow
          title={t('access.client.apiKey.title')}
          description={t('access.client.apiKey.description')}
          control={(
            <CopyableValue
              value={SAMPLE_API_KEY}
              copied={copiedKey === 'client-api-key'}
              onCopy={() => onCopy('client-api-key', SAMPLE_API_KEY)}
            />
          )}
        />
        <FormRow
          title={t('access.client.upstream.title')}
          description={t('access.client.upstream.description')}
          control={(
            <Button variant="outline" size="sm" onClick={() => void navigate({ to: routePaths.modelManagement })}>{t('access.client.goToModels')}</Button>
          )}
        />
      </CardContent>
    </Card>
  )
}
