import type { NodePanelProps } from '../node-data'
import { NodePanelHint } from './panel-fields'

export function InputPanel(_props: NodePanelProps) {
  return <NodePanelHint>输入节点无可配置项，仅作为路由入口。</NodePanelHint>
}
