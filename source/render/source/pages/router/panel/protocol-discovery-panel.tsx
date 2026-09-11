import type { NodePanelProps } from '../node-data'
import { NodePanelHint } from './panel-fields'

export function ProtocolDiscoveryPanel(_props: NodePanelProps) {
  return (
    <div className="grid gap-2.5">
      <NodePanelHint>
        协议发现节点为零配置节点：系统自动根据 request.path、request.headers、request.body.model 识别协议。
      </NodePanelHint>
      <NodePanelHint>
        协议分支输出口通过画布连线设置：openai-completions / openai-responses / anthropic-messages / unknown。
      </NodePanelHint>
    </div>
  )
}
