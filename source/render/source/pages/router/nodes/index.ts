import type { ComponentType } from 'react'

import type { WorkflowNodeKind } from '../types'
import type { RouteNodeProps } from '../node-data'
import { ConditionNodeView } from './condition-node'
import { ControlInputNodeView } from './control-input-node'
import { InputNodeView } from './input-node'
import { IterationNodeView } from './iteration-node'
import { ModelSelectNodeView } from './model-select-node'
import { OutputNodeView } from './output-node'
import { PromptNodeView } from './prompt-node'
import { ProtocolDiscoveryNodeView } from './protocol-discovery-node'
import { ScriptNodeView } from './script-node'

/**
 * 节点种类 → 节点内部视图。
 * 对应 Dify `app/components/workflow/nodes/index.tsx` 里的 NodeComponentMap：
 * 外壳（标题、端口、悬浮操作条）由 `components/workflow-node.tsx` 统一提供。
 */
export const NODE_COMPONENT_MAP: Record<WorkflowNodeKind, ComponentType<RouteNodeProps>> = {
  input: InputNodeView,
  'control-input': ControlInputNodeView,
  'protocol-discovery': ProtocolDiscoveryNodeView,
  condition: ConditionNodeView,
  'model-select': ModelSelectNodeView,
  iteration: IterationNodeView,
  script: ScriptNodeView,
  prompt: PromptNodeView,
  output: OutputNodeView,
}
