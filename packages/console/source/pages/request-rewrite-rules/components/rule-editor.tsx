import { Check } from 'lucide-react'
import { FormField, FormSection, FormSwitchRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { ActionEditor } from './action-editor'
import { PROTOCOL_LABELS, PROTOCOL_OPTIONS, type RequestRewriteRule } from '../types'
import type { Protocol } from '@common/schemas'

interface RuleEditorProps {
  rule: RequestRewriteRule
  onChange: (rule: RequestRewriteRule) => void
}

interface ProtocolPickerProps {
  label: string
  description: string
  selected: Protocol[]
  onToggle: (protocol: Protocol) => void
}

function ProtocolPicker(props: ProtocolPickerProps) {
  const t = useTranslation()
  return (
    <div className="grid gap-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="system-sm-medium text-text-secondary">{props.label}</div>
          <p className="mt-0.5 system-xs-regular text-text-tertiary">{props.description}</p>
        </div>
        <span className="shrink-0 rounded-md bg-inset px-1.5 py-0.5 system-2xs-medium text-text-tertiary">
          {props.selected.length ? t('rules.form.selectionCount', { count: props.selected.length }) : t('rules.form.selectionAll')}
        </span>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {PROTOCOL_OPTIONS.map(protocol => {
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
              <span className="leading-4">{PROTOCOL_LABELS[protocol]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function RuleEditor(props: RuleEditorProps) {
  const t = useTranslation()
  const { rule } = props
  const update = (patch: Partial<RequestRewriteRule>) => props.onChange({ ...rule, ...patch })
  const updateMatch = (patch: Partial<RequestRewriteRule['match']>) => update({ match: { ...rule.match, ...patch } })

  const toggleClientProtocol = (protocol: Protocol) => {
    const protocols = rule.protocols.includes(protocol)
      ? rule.protocols.filter(item => item !== protocol)
      : [...rule.protocols, protocol]
    update({ protocols, match: { ...rule.match, clientProtocols: protocols } })
  }

  const toggleUpstreamProtocol = (protocol: Protocol) => {
    const upstreamProtocols = rule.match.upstreamProtocols.includes(protocol)
      ? rule.match.upstreamProtocols.filter(item => item !== protocol)
      : [...rule.match.upstreamProtocols, protocol]
    updateMatch({ upstreamProtocols })
  }

  return (
    <div className="grid gap-4 px-4 py-4">
      <FormSection
        className="scroll-mt-16"
        description={t('rules.form.overview.description')}
        id="rule-overview"
        title={t('rules.form.overview.title')}
      >
        <div className="grid gap-3">
          <FormField label={t('rules.form.name')} htmlFor="rule-name">
            <Input id="rule-name" value={rule.name} onChange={event => update({ name: event.target.value })} placeholder={t('rules.form.namePlaceholder')} />
          </FormField>
          <FormField label={t('rules.form.descriptionLabel')} htmlFor="rule-description">
            <Textarea id="rule-description" className="min-h-20 resize-none" value={rule.description} onChange={event => update({ description: event.target.value })} placeholder={t('rules.form.descriptionPlaceholder')} />
          </FormField>
        </div>
        <div className="divide-y divide-border/50">
          <FormSwitchRow
            label={t('rules.form.enable')}
            description={t('rules.form.enableHint')}
            checked={rule.enabled}
            onCheckedChange={enabled => update({ enabled })}
          />
          <FormSwitchRow
            label={t('rules.form.global')}
            description={t('rules.form.globalHint')}
            checked={rule.global}
            onCheckedChange={global => update({ global })}
          />
        </div>
      </FormSection>

      <FormSection
        className="scroll-mt-16"
        description={t('rules.form.match.description')}
        id="rule-match"
        title={t('rules.form.match.title')}
      >
        <ProtocolPicker label={t('rules.form.clientProtocols')} description={t('rules.form.clientProtocolsHint')} selected={rule.protocols} onToggle={toggleClientProtocol} />
        <ProtocolPicker label={t('rules.form.upstreamProtocols')} description={t('rules.form.upstreamProtocolsHint')} selected={rule.match.upstreamProtocols} onToggle={toggleUpstreamProtocol} />
      </FormSection>

      <FormSection className="scroll-mt-16" id="rule-actions">
        <ActionEditor actions={rule.actions} onChange={actions => update({ actions })} />
      </FormSection>
    </div>
  )
}
