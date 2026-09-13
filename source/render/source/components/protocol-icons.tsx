import { BotMessageSquare, MessageSquareCode, Repeat, Sparkles } from 'lucide-react'
import type { Protocol, ProviderModelRouteEndpoint } from '@common/schemas'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/i18n/provider'

const PROTOCOL_META: Record<Protocol, { label: string; icon: typeof MessageSquareCode }> = {
  'openai-completions': { label: 'OpenAI Completions', icon: MessageSquareCode },
  'openai-responses': { label: 'OpenAI Responses', icon: Sparkles },
  'anthropic-messages': { label: 'Anthropic Messages', icon: BotMessageSquare },
}

interface ProtocolIconsProps {
  endpoints: ProviderModelRouteEndpoint[]
}

export function ProtocolIcons(props: ProtocolIconsProps) {
  const { endpoints } = props
  const t = useTranslation()

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex shrink-0 items-center gap-0.5">
        {endpoints.map(endpoint => {
          const meta = PROTOCOL_META[endpoint.protocol]
          const ProtocolIcon = meta.icon
          return (
            <Tooltip key={endpoint.protocol}>
              <TooltipTrigger asChild>
                <span className="inline-flex size-5 items-center justify-center rounded-md bg-inset text-text-tertiary" aria-label={meta.label}>
                  <ProtocolIcon size={11} aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>{meta.label}</TooltipContent>
            </Tooltip>
          )
        })}
        {endpoints
          .filter(endpoint => endpoint.protocolConversionEnabled)
          .flatMap(endpoint => CONVERTIBLE_PROTOCOLS[endpoint.protocol]
            .filter(from => !endpoints.some(native => native.protocol === from))
            .map(from => {
              const meta = PROTOCOL_META[from]
              const ProtocolIcon = meta.icon
              return (
                <Tooltip key={`conv-${endpoint.protocol}-${from}`}>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex size-5 items-center justify-center rounded-md bg-warning/10 text-text-warning"
                      aria-label={t('protocol.conversion.aria', { protocol: meta.label })}
                    >
                      <ProtocolIcon size={9} aria-hidden className="m-0.5" />
                      <Repeat size={7} aria-hidden className="-ml-1.5 -mb-1.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('protocol.conversion.tooltip', { protocol: meta.label, target: PROTOCOL_META[endpoint.protocol].label })}</TooltipContent>
                </Tooltip>
              )
            }))}
      </div>
    </TooltipProvider>
  )
}
