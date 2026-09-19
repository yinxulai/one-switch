import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ScrollText } from 'lucide-react'
import type { TelemetryPreview } from '@common/telemetry'
import { telemetryApi } from '@/api/runtime'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormRow } from '@/components/form-kit'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/provider'

interface TelemetryCardProps {
  enabled: boolean
  onEnabledChange: (value: boolean) => void
}

/**
 * 匿名使用统计的开关与「自证」。
 *
 * 预览不是本地拼出来的样例，而是向 core 要的**当前状态**（`/telemetry/preview`）：设置页展示的
 * 内容必须与真正上报的内容出自同一条组装路径，否则这段「自证」只是自我安慰（telemetry.md §13）。
 *
 * 因此这里也如实展示 `running`：开关开着却不上报有好几种原因（开发档、标识写不动、平台认不出），
 * 把「开着 = 在上报」当成同一件事，用户就没法从界面上判断真相。
 */
export function TelemetryCard(props: TelemetryCardProps) {
  const { enabled, onEnabledChange } = props
  const t = useTranslation()
  const [preview, setPreview] = useState<TelemetryPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const next = await telemetryApi.preview(signal)
      if (signal?.aborted) return
      setPreview(next)
      setError(null)
    } catch (caught) {
      if (signal?.aborted) return
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  const running = preview?.running ?? false
  const sourceLabel = preview?.source === 'queue' ? t('settings.telemetry.sourceQueue') : t('settings.telemetry.sourceSample')
  // 草稿与已保存值不一致时预览必然对不上：它读的是 core 的当前状态，不是表单草稿。
  const draftDiffers = preview !== null && preview.enabled !== enabled

  return (
    <Card>
      <SettingsCardHeader
        icon={<ScrollText />}
        title={t('settings.telemetry.title')}
        description={t('settings.telemetry.description')}
        actions={<Badge variant="muted">{running ? t('settings.telemetry.runningBadge') : t('settings.telemetry.stoppedBadge')}</Badge>}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title={t('settings.telemetry.enabled')}
          description={t('settings.telemetry.enabledDescription')}
          control={<Switch checked={enabled} onCheckedChange={onEnabledChange} />}
        />

        {!running && enabled && (
          <p className="py-3 system-xs-regular text-text-tertiary">{t('settings.telemetry.notRunningHint')}</p>
        )}

        <FormRow
          title={t('settings.telemetry.endpoint')}
          description={t('settings.telemetry.endpointDescription')}
          control={<span className="max-w-72 truncate system-2xs-regular text-text-tertiary">{preview?.endpoint ?? '—'}</span>}
        />

        <FormRow
          title={t('settings.telemetry.installId')}
          description={t('settings.telemetry.installIdDescription')}
          control={<span className="max-w-72 truncate system-2xs-regular text-text-tertiary">{preview?.installId ?? '—'}</span>}
        />

        <div className="py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="system-sm-medium text-text-primary">{t('settings.telemetry.preview')}</div>
              <p className="mt-0.5 system-xs-regular text-text-tertiary">{t('settings.telemetry.previewDescription')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="muted">{sourceLabel}</Badge>
              <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
                <RefreshCw className={loading ? 'animate-spin' : undefined} />
                {t('settings.telemetry.refresh')}
              </Button>
            </div>
          </div>
          {draftDiffers && (
            <p className="mt-2 system-xs-regular text-text-tertiary">{t('settings.telemetry.draftHint')}</p>
          )}
          {error !== null && (
            <p className="mt-2 system-xs-regular text-text-destructive">{t('settings.telemetry.previewFailed', { message: error })}</p>
          )}
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-module-border p-3 font-mono system-2xs-regular text-text-secondary">
            {preview === null ? '—' : JSON.stringify(preview.events, null, 2)}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}
