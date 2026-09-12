import { Repeat } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import { PROTOCOL_SHORT_LABELS } from '../lib/protocols'
import type { ProtocolEndpointEntry } from '../hooks/types'

interface ProtocolConversionSettingsProps {
  entry: ProtocolEndpointEntry
  index: number
  updateProtocolEntry: (index: number, patch: Partial<ProtocolEndpointEntry>) => void
}

export function ProtocolConversionSettings(props: ProtocolConversionSettingsProps) {
  const { entry, index, updateProtocolEntry } = props
  const convertibleProtocols = CONVERTIBLE_PROTOCOLS[entry.protocol]

  if (convertibleProtocols.length === 0) return null

  return (
    <div className="grid gap-2 rounded-lg border border-module-border bg-card p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Repeat className="size-3.5 text-text-tertiary" aria-hidden />
          <span className="system-sm-medium text-text-primary">协议转换</span>
        </div>
        <Switch
          checked={entry.protocolConversionEnabled}
          onCheckedChange={checked => updateProtocolEntry(index, { protocolConversionEnabled: checked })}
        />
      </div>
      <p className="system-xs-regular text-text-tertiary">
        开启后，此端点可接收其他协议的请求并自动转换（兼容层，部分参数可能丢失）
      </p>
      {entry.protocolConversionEnabled && (
        <div className="flex flex-wrap gap-1">
          {convertibleProtocols.map(from => (
            <span
              key={from}
              className="inline-flex items-center gap-1 rounded-md bg-state-warning-hover px-1.5 py-0.5 system-2xs-medium text-text-warning"
            >
              <Repeat className="size-2.5" aria-hidden />
              {PROTOCOL_SHORT_LABELS[from]} → {PROTOCOL_SHORT_LABELS[entry.protocol]}
            </span>
          ))}
          <p className="w-full system-2xs-regular text-text-tertiary">
            原生请求优先；转换请求仅在没有原生候选时使用
          </p>
        </div>
      )}
    </div>
  )
}
