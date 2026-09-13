import { Check, Copy, Server } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { routePaths } from '@/routes'

interface EndpointEntry {
  key: string
  title: string
  protocols: string
  url: string
}

interface EndpointRowProps {
  entry: EndpointEntry
  copied: boolean
  onCopy: (key: string, value: string) => void
}

interface ServiceEndpointCardProps {
  running: boolean
  host: string
  port: number | null
  baseUrl: string
  wildcardHost: boolean
  copiedKey: string | null
  onCopy: (key: string, value: string) => void
}

/**
 * 两种接入协议各占一行：OpenAI 的两种协议共用一个 Base URL，Anthropic 的 Messages 走独立路径。
 * 协议名（Chat Completions / Responses / Messages）是规范里的专有名词，不进文案表。
 */
function buildEntries(t: AppTranslator, baseUrl: string): EndpointEntry[] {
  return [
    {
      key: 'openai',
      title: t('access.endpoint.openai.title'),
      protocols: 'Chat Completions · Responses',
      url: baseUrl ? `${baseUrl}/v1` : '',
    },
    {
      key: 'anthropic',
      title: t('access.endpoint.anthropic.title'),
      protocols: 'Messages',
      url: baseUrl ? `${baseUrl}/v1/messages` : '',
    },
  ]
}

/**
 * 监听状态。监听 `0.0.0.0` 时它本身不是可访问地址，这里直接说明客户端该用哪个地址，
 * 不让用户自己去翻译「所有网卡」是什么意思。
 */
function describeListening(t: AppTranslator, host: string, port: number | null, wildcardHost: boolean): string {
  if (!host || port === null) return t('access.endpoint.reading')
  if (wildcardHost) return t('access.endpoint.listeningWildcard', { host, port })
  return t('access.endpoint.listening', { host, port })
}

function EndpointRow(props: EndpointRowProps) {
  const { entry, copied, onCopy } = props
  const t = useTranslation()
  return (
    <div className="grid min-w-0 gap-2 py-3.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="system-sm-medium text-text-primary">{entry.title}</span>
        <span className="system-2xs-regular text-text-quaternary">{entry.protocols}</span>
      </div>
      {/* 复制按钮跟地址同一行，紧挨着被复制的对象；地址等宽、可整段选中。 */}
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono system-sm-regular text-text-primary select-all">
          {entry.url || '—'}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!entry.url}
          onClick={() => onCopy(entry.key, entry.url)}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? t('common.action.copied') : t('access.endpoint.copyUrl')}
        </Button>
      </div>
    </div>
  )
}

export function ServiceEndpointCard(props: ServiceEndpointCardProps) {
  const { running, host, port, baseUrl, wildcardHost, copiedKey, onCopy } = props
  const navigate = useNavigate()
  const t = useTranslation()
  return (
    <Card>
      <SettingsCardHeader
        icon={<Server />}
        title={t('access.endpoint.title')}
        description={describeListening(t, host, port, wildcardHost)}
        actions={(
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="xs" onClick={() => void navigate({ to: routePaths.runtimeSettings })}>{t('access.endpoint.changeHost')}</Button>
            <Badge variant={running ? 'success' : 'muted'}>
              <span className={cn('size-1.5 rounded-full', running ? 'bg-success-foreground motion-safe:animate-pulse' : 'bg-text-quaternary')} />
              {running ? t('access.endpoint.running') : t('access.endpoint.stopped')}
            </Badge>
          </div>
        )}
      />
      <CardContent className="divide-y divide-border/50">
        {buildEntries(t, baseUrl).map(entry => (
          <EndpointRow key={entry.key} entry={entry} copied={copiedKey === entry.key} onCopy={onCopy} />
        ))}
      </CardContent>
    </Card>
  )
}
