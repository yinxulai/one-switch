import { FormSection, FormSwitchRow } from '@/components/form-kit'
import { useTranslation } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'

interface TelemetryStepProps {
  enabled: boolean
  onEnabledChange: (value: boolean) => void
}

/**
 * 「发什么 / 不发什么」两栏。key 写成完整字面量而不是拼前缀：目录门禁靠「key 在源码里出现过」
 * 判死 key（`catalogs.test.ts`），拼出来的 key 会被当成没人引用。
 */
const SENT_ITEMS: UiCatalogKey[] = [
  'onboarding.telemetry.sent.system',
  'onboarding.telemetry.sent.usage',
  'onboarding.telemetry.sent.install',
  'onboarding.telemetry.sent.geo',
]

const NOT_SENT_ITEMS: UiCatalogKey[] = [
  'onboarding.telemetry.notSent.content',
  'onboarding.telemetry.notSent.credentials',
  'onboarding.telemetry.notSent.provider',
  'onboarding.telemetry.notSent.machine',
]

/**
 * 第四步：匿名使用统计的同意。
 *
 * 默认**不勾选**，并且与「跳过引导」是两件事：跳过不等于同意（telemetry.md §13），
 * 所以开关初值恒为 `false`，只有手指真的划过它才会变成 `true`。
 *
 * 内容按「发什么 / 不发什么」两栏摆开，而不是一句「帮助我们改进产品」。用户要能据此判断，
 * 才有所谓知情同意；只给一个开关的同意只是流程上的一道手续。逐条报文可以在设置页看到真实的
 * 一份（`onboarding.telemetry.previewHint`），这里不假装它就是全部。
 */
export function TelemetryStep(props: TelemetryStepProps) {
  const { enabled, onEnabledChange } = props
  const t = useTranslation()

  return (
    <div className="space-y-4">
      <FormSection title={t('onboarding.telemetry.consent')} description={t('onboarding.telemetry.consentDescription')}>
        <FormSwitchRow
          label={t('onboarding.telemetry.switchLabel')}
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </FormSection>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormSection title={t('onboarding.telemetry.sentTitle')}>
          <ul className="ml-4 flex list-disc flex-col gap-1.5">
            {SENT_ITEMS.map(item => (
              <li key={item} className="system-xs-regular text-text-secondary">{t(item)}</li>
            ))}
          </ul>
        </FormSection>
        <FormSection title={t('onboarding.telemetry.notSentTitle')}>
          <ul className="ml-4 flex list-disc flex-col gap-1.5">
            {NOT_SENT_ITEMS.map(item => (
              <li key={item} className="system-xs-regular text-text-secondary">{t(item)}</li>
            ))}
          </ul>
        </FormSection>
      </div>

      <p className="system-xs-regular text-text-tertiary">{t('onboarding.telemetry.previewHint')}</p>
    </div>
  )
}
