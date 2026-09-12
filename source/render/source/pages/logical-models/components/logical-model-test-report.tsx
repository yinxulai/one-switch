import { Activity, FlaskConical, Loader2 } from 'lucide-react'
import type { Protocol } from '@common/schemas'
import type { ModelTestResult } from '@/api/tools'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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
  if (props.protocols.length === 0) return null

  return (
    <div className="flex items-center gap-2">
      <Select value={props.selectedProtocol} onValueChange={value => props.onProtocolChange(value as Protocol | 'all')}>
        <SelectTrigger aria-label="选择探测协议" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部协议</SelectItem>
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
        {props.running ? '探测中' : '运行探测'}
      </Button>
    </div>
  )
}

export function LogicalModelTestSummary(props: LogicalModelTestSummaryProps) {
  const successCount = props.results.filter(result => result.success).length
  const failureCount = props.results.length - successCount

  return (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 rounded-lg border border-module-border bg-inset px-3 py-2.5 system-2xs-regular">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 system-xs-medium text-text-primary">
          <Activity size={12} className="text-primary" aria-hidden />
          逻辑模型连通性报告
        </div>
        <div className="mt-0.5 truncate text-text-tertiary">
          已探测 {props.protocolCount} 个协议、{props.results.length} 个可用供应商模型
        </div>
      </div>
      <div className="text-center">
        <div className="font-mono system-md-medium text-text-success">{successCount}</div>
        <div className="system-2xs-medium-uppercase text-text-tertiary">成功</div>
      </div>
      <div className="text-center">
        <div className="font-mono system-md-medium text-text-destructive">{failureCount}</div>
        <div className="system-2xs-medium-uppercase text-text-tertiary">失败</div>
      </div>
      <button className="text-text-tertiary transition-colors hover:text-text-primary" onClick={props.onClose}>关闭</button>
    </div>
  )
}
