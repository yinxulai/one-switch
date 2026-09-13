import { Activity, FlaskConical, Loader2 } from 'lucide-react'
import type { Protocol } from '@common/schemas'
import type { ModelTestResult } from '@/api/tools'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslation } from '@/i18n/provider'

export interface ProtocolTestResult extends ModelTestResult {
  protocol: Protocol
}

interface LogicalModelTestControlsProps {
  protocols: Protocol[]
  selectedProtocol: Protocol | 'all'
  running: boolean
  disabled: boolean
  onProtocolChange: (protocol: Protocol | 'all') => void
  onRun: () => void
}

interface LogicalModelTestSummaryProps {
  protocolCount: number
  results: ProtocolTestResult[]
  onClose: () => void
}

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  'openai-completions': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic',
}

export function LogicalModelTestControls(props: LogicalModelTestControlsProps) {
  const t = useTranslation()
  if (props.protocols.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <Select value={props.selectedProtocol} onValueChange={value => props.onProtocolChange(value as Protocol | 'all')}>
        <SelectTrigger aria-label={t('logicalModels.test.protocolAria')} className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('logicalModels.test.allProtocols')}</SelectItem>
          {props.protocols.map(protocol => (
            <SelectItem key={protocol} value={protocol}>{PROTOCOL_LABELS[protocol]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-3 system-xs-medium"
        onClick={props.onRun}
        disabled={props.running || props.disabled}
      >
        {props.running ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
        {props.running ? t('logicalModels.test.running') : t('logicalModels.test.run')}
      </Button>
    </div>
  )
}

export function LogicalModelTestSummary(props: LogicalModelTestSummaryProps) {
  const t = useTranslation()
  const successCount = props.results.filter(result => result.success).length
  const failureCount = props.results.length - successCount

  return (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 rounded-lg border border-module-border bg-inset px-3 py-2.5 system-2xs-regular">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 system-xs-medium text-text-primary">
          <Activity size={12} className="text-primary" aria-hidden />
          {t('logicalModels.test.reportTitle')}
        </div>
        <div className="mt-0.5 truncate text-text-tertiary">
          {t('logicalModels.test.reportSummary', { protocols: props.protocolCount, models: props.results.length })}
        </div>
      </div>
      <div className="text-center">
        <div className="font-mono system-md-medium text-text-success">{successCount}</div>
        <div className="system-2xs-medium-uppercase text-text-tertiary">{t('logicalModels.test.success')}</div>
      </div>
      <div className="text-center">
        <div className="font-mono system-md-medium text-text-destructive">{failureCount}</div>
        <div className="system-2xs-medium-uppercase text-text-tertiary">{t('logicalModels.test.failure')}</div>
      </div>
      <button className="text-text-tertiary transition-colors hover:text-text-primary" onClick={props.onClose}>{t('logicalModels.test.close')}</button>
    </div>
  )
}
