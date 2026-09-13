import { useState } from 'react'
import { Check, Copy, KeyRound, Plug, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'

interface ProxyConfigCardProps {
  proxyBaseUrl: string
  proxyPort: number
  proxyRunning: boolean
  copied: boolean
  onCopyEndpoint: (url: string) => void
}

const PROTOCOLS = [
  { key: 'openai-completions', label: 'OpenAI Completions', path: '/v1/chat/completions' },
  { key: 'openai-responses', label: 'OpenAI Responses', path: '/v1/responses' },
  { key: 'anthropic-messages', label: 'Anthropic Messages', path: '/v1/messages' },
] as const

export function ProxyConfigCard(props: ProxyConfigCardProps) {
  const { proxyBaseUrl, proxyPort, proxyRunning, copied, onCopyEndpoint } = props
  const t = useTranslation()
  const [selectedProtocol, setSelectedProtocol] = useState<string>('openai-completions')

  const protocolInfo = PROTOCOLS.find(p => p.key === selectedProtocol)
  const fullUrl = protocolInfo ? `${proxyBaseUrl}${protocolInfo.path}` : proxyBaseUrl

  return (
    <Card className="bg-card">
      <CardHeader className="flex-row justify-between gap-3 pb-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Server size={16} />
          </div>
          <div>
            <CardTitle>{t('logicalModels.proxy.title')}</CardTitle>
            <CardDescription className="mt-0.5">
              {t('logicalModels.proxy.description')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_1fr]">
          <FormField
            label={<span className="flex items-center gap-1"><Plug className="size-3.5" aria-hidden />{t('logicalModels.proxy.endpoint')}</span>}
            htmlFor="proxy-protocol"
          >
            <div className="flex gap-2">
              <Select value={selectedProtocol} onValueChange={setSelectedProtocol}>
                <SelectTrigger id="proxy-protocol" className="w-44 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOLS.map(p => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input readOnly value={fullUrl} className="flex-1 font-mono" />
              <Button
                variant="outline"
                className="shrink-0"
                disabled={!proxyRunning}
                onClick={() => void onCopyEndpoint(fullUrl)}
              >
                <Copy size={13} /> {copied ? t('common.action.copied') : t('common.action.copy')}
              </Button>
            </div>
          </FormField>
          <FormField label={<span className="flex items-center gap-1"><KeyRound className="size-3.5" aria-hidden />{t('logicalModels.proxy.status')}</span>}>
            <div className="flex h-8 items-center justify-between rounded-lg bg-components-input-bg-normal px-3">
              <div className="flex items-center">
                <span
                  className={cn(
                    'mr-2 h-1.5 w-1.5 rounded-full',
                    proxyRunning ? 'bg-success animate-pulse' : 'bg-text-quaternary',
                  )}
                />
                <span className="system-xs-regular text-text-secondary">{proxyRunning ? t('logicalModels.proxy.running') : t('logicalModels.proxy.paused')}</span>
              </div>
              <span className="font-mono system-xs-regular text-text-tertiary">
                :{proxyPort}
              </span>
            </div>
          </FormField>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-module-border bg-workflow-block-parma-bg px-3.5 py-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-success/10 text-text-success">
            <KeyRound size={14} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="system-xs-medium text-text-primary">{t('logicalModels.proxy.noKeyTitle')}</p>
              <span className="inline-flex items-center gap-1 system-2xs-medium text-text-success">
                <Check size={11} aria-hidden /> {t('logicalModels.proxy.ready')}
              </span>
            </div>
            <p className="mt-1 system-xs-regular text-text-tertiary">
              {t('logicalModels.proxy.noKeyDescription')}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
