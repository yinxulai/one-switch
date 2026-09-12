import type { Protocol } from '@common/schemas'
import { PROTOCOL_EXAMPLES } from '../lib/protocols'

interface ProtocolUrlHintProps {
  protocol: Protocol
}

export function ProtocolUrlHint(props: ProtocolUrlHintProps) {
  const { protocol } = props
  const examples = PROTOCOL_EXAMPLES[protocol]
  return (
    <div className="grid gap-1.5 rounded-lg border border-module-border bg-card px-3 py-2">
      <p className="system-2xs-regular text-text-tertiary">
        完整接口地址需包含协议、主机、路径，指向该模型真实的 <span className="font-mono text-text-secondary">{protocol}</span> 端点。
      </p>
      <div className="grid gap-0.5">
        {examples.map(example => (
          <div key={example.url} className="flex items-center gap-1.5 font-mono system-2xs-regular">
            <span className="shrink-0 text-text-tertiary">{example.provider}：</span>
            <code className="truncate text-text-quaternary">{example.url}</code>
          </div>
        ))}
      </div>
    </div>
  )
}
