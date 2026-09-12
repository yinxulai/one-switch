import { Check, Copy, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'
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

function buildEntries(baseUrl: string): EndpointEntry[] {
  return [
    {
      key: 'openai',
      title: 'OpenAI 兼容',
      protocols: 'Chat Completions · Responses',
      hint: '两种 OpenAI 协议共用这个 Base URL',
      url: baseUrl ? `${baseUrl}/v1` : '',
    },
    {
      key: 'anthropic',
      title: 'Anthropic',
      protocols: 'Messages',
      hint: 'Messages 协议使用独立路径',
      url: baseUrl ? `${baseUrl}/v1/messages` : '',
    },
  ]
}

function describeListening(host: string, port: number | null, wildcardHost: boolean): string {
  if (!host || port === null) return '正在读取服务状态…'
  if (wildcardHost) return `监听 ${host}:${port}（所有网卡），本机客户端请使用 127.0.0.1`
  return `监听 ${host}:${port}，请求按模型名路由到对应逻辑模型，未命中回落到默认逻辑模型`
}

function EndpointRow(props: EndpointRowProps) {
  const { entry, copied, onCopy } = props
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
          {copied ? '已复制' : '复制地址'}
        </Button>
      </div>
      <span className="truncate font-mono system-sm-regular text-text-primary">{entry.url || '服务启动后显示'}</span>
    </div>
  )
}

export function ServiceEndpointCard(props: ServiceEndpointCardProps) {
  const { running, host, port, baseUrl, wildcardHost, copiedKey, onCopy, onNavigateToSettings } = props
  return (
    <Card>
      <SettingsCardHeader
        icon={<Server />}
        title="本地代理服务"
        description={describeListening(host, port, wildcardHost)}
        actions={(
          <div className="flex shrink-0 items-center gap-2">
            {onNavigateToSettings && (
              <Button variant="ghost" size="xs" onClick={onNavigateToSettings}>修改监听地址</Button>
            )}
            <Badge variant={running ? 'success' : 'muted'}>
              <span className={cn('size-1.5 rounded-full', running ? 'bg-success-foreground motion-safe:animate-pulse' : 'bg-text-quaternary')} />
              {running ? '服务运行中' : '服务已停止'}
            </Badge>
          </div>
        )}
      />
      <CardContent className="divide-y divide-border/50">
        {buildEntries(baseUrl).map(entry => (
          <EndpointRow key={entry.key} entry={entry} copied={copiedKey === entry.key} onCopy={onCopy} />
        ))}
      </CardContent>
    </Card>
  )
}
