import { Check, Copy } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { FormRow } from '@/components/form-kit'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'
import { routePaths } from '@/routes'
import { StepCard } from './step-card'

/**
 * 客户端强制要求填写、但本地服务并不校验的两个值。
 *
 * 这两个值是可以直接粘进客户端的样例：模型名会命中原有的 `default` 逻辑模型，
 * API Key 只要非空即可（本地服务不鉴权）。给样例就能省掉用户当场编一个值，
 * 也是这一步存在的唯一理由——地址给完之后，用户接下来一定会卡在这两个空框上。
 */
const SAMPLE_MODEL_NAME = 'default'
const SAMPLE_API_KEY = 'sk-one-switch'

interface CopyableValueProps {
  value: string
  copied: boolean
  onCopy: () => void
}

interface ClientCredentialStepProps {
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
}

/** 可复制的样例值：等宽文本 + 就地复制按钮，回执留在按钮上。 */
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

/** 第三步：地址填完之后，客户端还会拦着要的字段。 */
export function ClientCredentialStep(props: ClientCredentialStepProps) {
  const { copiedKey, onCopy } = props
  const navigate = useNavigate()
  const t = useTranslation()
  return (
    <StepCard
      index={3}
      title={t('access.step.fields.title')}
      description={t('access.step.fields.description')}
    >
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate({ to: routePaths.modelManagement })}
          >
            {t('access.client.goToModels')}
          </Button>
        )}
      />
    </StepCard>
  )
}
