import type { ComponentType } from 'react'

import type { WorkflowNodeKind } from '@common/router/types'
import type { NodePanelProps } from '../node-data'
import { ConditionPanel } from './condition-panel'
import { ControlInputPanel } from './control-input-panel'
import { InputPanel } from './input-panel'
import { IterationPanel } from './iteration-panel'
import { ModelSelectPanel } from './model-select-panel'
import { OutputPanel } from './output-panel'
import { PromptPanel } from './prompt-panel'
import { ProtocolDiscoveryPanel } from './protocol-discovery-panel'
import { ScriptPanel } from './script-panel'

/**
 * 节点种类 → 右侧面板内容。
 * 对应上游 `app/components/workflow/nodes/index.tsx` 里的 PanelComponentMap。
 */
export const PANEL_COMPONENT_MAP: Record<WorkflowNodeKind, ComponentType<NodePanelProps>> = {
  input: InputPanel,
  'control-input': ControlInputPanel,
  'protocol-discovery': ProtocolDiscoveryPanel,
  condition: ConditionPanel,
  'model-select': ModelSelectPanel,
  iteration: IterationPanel,
  script: ScriptPanel,
  prompt: PromptPanel,
  output: OutputPanel,
}
