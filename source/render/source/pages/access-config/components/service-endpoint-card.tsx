import { Check, Copy, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import { cn } from '@/lib/utils'

interface EndpointEntry {
  key: string
  title: string
  protocols: string
  hint: string
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
  onNavigateToSettings?: () => void
}

function buildEntries(t: AppTranslator, baseUrl: string): EndpointEntry[] {
  return [
    {
      key: 'openai',
      title: t('access.endpoint.openai.title'),
      protocols: 'Chat Completions · Responses',
      hint: t('access.endpoint.openai.hint'),
      url: baseUrl ? `${baseUrl}/v1` : '',
    },
    {
      key: 'anthropic',
      title: 'Anthropic',
      protocols: 'Messages',
      hint: t('access.endpoint.anthropic.hint'),
      url: baseUrl ? `${baseUrl}/v1/messages` : '',
    },
  ]
}

function describeListening(t: AppTranslator, host: string, port: number | null, wildcardHost: boolean): string {
  if (!host || port === null) return t('access.endpoint.reading')
  if (wildcardHost) return t('access.endpoint.listeningWildcard', { host, port })
  return t('access.endpoint.listening', { host, port })
}

function EndpointRow(props: EndpointRowProps) {
  const { entry, copied, onCopy } = props
  const t = useTranslation()
  return (
    <div className="grid gap-2 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="system-sm-medium text-text-primary">{entry.title}</span>
            <span className="system-xs-regular text-text-quaternary">{entry.protocols}</span>
          </div>
          <p className="mt-0.5 system-xs-regular text-text-tertiary">{entry.hint}</p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" disabled={!entry.url} onClick={() => onCopy(entry.key, entry.url)}>
          {copied ? <Check /> : <Copy />}
          {copied ? t('common.action.copied') : t('access.endpoint.copyUrl')}
        </Button>
      </div>
      <span className="truncate font-mono system-sm-regular text-text-primary">{entry.url || t('access.endpoint.urlPending')}</span>
    </div>
  )
}

export function ServiceEndpointCard(props: ServiceEndpointCardProps) {
  const { running, host, port, baseUrl, wildcardHost, copiedKey, onCopy, onNavigateToSettings } = props
  const t = useTranslation()
  return (
    <Card>
      <SettingsCardHeader
        icon={<Server />}
        title={t('access.endpoint.title')}
        description={describeListening(t, host, port, wildcardHost)}
        actions={(
          <div className="flex shrink-0 items-center gap-2">
            {onNavigateToSettings && (
              <Button variant="ghost" size="xs" onClick={onNavigateToSettings}>{t('access.endpoint.changeHost')}</Button>
            )}
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
