import { Check } from 'lucide-react'
import { FormField, FormSection, FormSwitchRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ActionEditor } from './action-editor'
import { protocolOptions, type RequestRewriteRule } from '../types'

interface RuleEditorProps {
  rule: RequestRewriteRule
  onChange: (rule: RequestRewriteRule) => void
}

interface ProtocolPickerProps {
  label: string
  description: string
  selected: string[]
  onToggle: (protocol: string) => void
}

function ProtocolPicker(props: ProtocolPickerProps) {
  return (
    <div className="grid gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="system-sm-medium text-text-secondary">{props.label}</div>
          <p className="mt-0.5 system-xs-regular text-text-tertiary">{props.description}</p>
        </div>
        <span className="shrink-0 rounded-md bg-inset px-1.5 py-0.5 system-2xs-medium text-text-tertiary">
          {props.selected.length ? `${props.selected.length} 个` : '全部'}
        </span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {protocolOptions.map(protocol => {
          const selected = props.selected.includes(protocol)
          return (
            <button
              key={protocol}
              type="button"
              aria-pressed={selected}
              onClick={() => props.onToggle(protocol)}
              className={cn(
                'flex min-h-10 items-center gap-2 rounded-lg border border-module-border bg-card px-2.5 py-2 text-left system-xs-medium text-text-secondary transition-colors hover:bg-state-base-hover-alt hover:text-text-primary',
                selected && 'bg-accent text-text-primary dark:bg-accent',
              )}
            >
              <span className={cn('flex size-4 shrink-0 items-center justify-center rounded bg-inset', selected && 'bg-primary text-primary-foreground')}>
                {selected && <Check className="size-3" aria-hidden />}
              </span>
              <span className="leading-4">{protocol}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function RuleEditor(props: RuleEditorProps) {
  const { rule } = props
  const update = (patch: Partial<RequestRewriteRule>) => props.onChange({ ...rule, ...patch })
  const updateMatch = (patch: Partial<RequestRewriteRule['match']>) => update({ match: { ...rule.match, ...patch } })

  const toggleClientProtocol = (protocol: string) => {
    const protocols = rule.protocols.includes(protocol)
      ? rule.protocols.filter(item => item !== protocol)
      : [...rule.protocols, protocol]
    update({ protocols })
  }

  const toggleUpstreamProtocol = (protocol: string) => {
    const valueByLabel = Object.fromEntries(protocolOptions.map((label, index) => [label, ['openai-completions', 'openai-responses', 'anthropic-messages'][index]]))
    const value = valueByLabel[protocol]
    const upstreamProtocols = rule.match.upstreamProtocols.includes(value)
      ? rule.match.upstreamProtocols.filter(item => item !== value)
      : [...rule.match.upstreamProtocols, value]
    updateMatch({ upstreamProtocols })
  }

  const upstreamLabels = rule.match.upstreamProtocols.map(value => ({
    'openai-completions': 'OpenAI Completions',
    'openai-responses': 'OpenAI Responses',
    'anthropic-messages': 'Anthropic Messages',
  })[value] ?? value)

  return (
    <div className="grid gap-4 px-4 py-4">
      <FormSection
        className="scroll-mt-16"
        description="命名规则并决定它如何生效。"
        id="rule-overview"
        title="概览"
      >
        <div className="grid gap-3">
          <FormField label="规则名称" htmlFor="rule-name">
            <Input id="rule-name" value={rule.name} onChange={event => update({ name: event.target.value })} placeholder="例如：移除不兼容参数" />
          </FormField>
          <FormField label="说明（可选）" htmlFor="rule-description">
            <Textarea id="rule-description" className="min-h-20 resize-none" value={rule.description} onChange={event => update({ description: event.target.value })} placeholder="说明这条规则解决什么兼容问题" />
          </FormField>
        </div>
        <div className="divide-y divide-border/50">
          <FormSwitchRow
            label="启用规则"
            description="停用后不参与任何请求"
            checked={rule.enabled}
            onCheckedChange={enabled => update({ enabled })}
          />
          <FormSwitchRow
            label="全局应用"
            description="无需绑定模型即可生效"
            checked={rule.global}
            onCheckedChange={global => update({ global })}
          />
        </div>
      </FormSection>

      <FormSection
        className="scroll-mt-16"
        description="所有已填写条件同时满足时执行；留空表示不限制。"
        id="rule-match"
        title="匹配条件"
      >
        <ProtocolPicker label="客户端协议" description="进入代理时识别到的协议" selected={rule.protocols} onToggle={toggleClientProtocol} />
        <ProtocolPicker label="上游协议" description="协议转换后发往供应商的协议" selected={upstreamLabels} onToggle={toggleUpstreamProtocol} />
      </FormSection>

      <FormSection className="scroll-mt-16" id="rule-actions">
        <ActionEditor actions={rule.actions} onChange={actions => update({ actions })} />
      </FormSection>
    </div>
  )
}
