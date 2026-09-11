import type { ComponentType } from 'react'

import type { WorkflowNodeKind } from '../types'
import type { NodePanelProps } from '../node-data'
import { ConditionPanel } from './condition-panel'
import { ControlInputPanel } from './control-input-panel'
import { InputPanel } from './input-panel'
import { OutputPanel } from './output-panel'
import { ProtocolDiscoveryPanel } from './protocol-discovery-panel'
import { QueueSelectPanel } from './queue-select-panel'

/**
 * 节点种类 → 右侧面板内容。
 * 对应 Dify `app/components/workflow/nodes/index.tsx` 里的 PanelComponentMap。
 */
export const PANEL_COMPONENT_MAP: Record<WorkflowNodeKind, ComponentType<NodePanelProps>> = {
  input: InputPanel,
  'control-input': ControlInputPanel,
  'protocol-discovery': ProtocolDiscoveryPanel,
  condition: ConditionPanel,
  'queue-select': QueueSelectPanel,
  output: OutputPanel,
}
