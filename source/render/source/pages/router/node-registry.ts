import type { EdgeTypes, NodeTypes } from '@xyflow/react'

import { WorkflowEdge } from './components/workflow-edge'
import { WorkflowNode } from './components/workflow-node'

/**
 * 画布节点类型注册表。
 * 对应 Dify `app/components/workflow/nodes/index.tsx` 的 `NodeComponentMap`：
 * 六种节点共用一个外壳组件 `WorkflowNode`，内部再按 `model.kind` 渲染各自的内容。
 */
const workflowNodeTypes = {
  'route-input': WorkflowNode,
  'control-input': WorkflowNode,
  'route-output': WorkflowNode,
  'protocol-discovery': WorkflowNode,
  condition: WorkflowNode,
  'model-select': WorkflowNode,
  iteration: WorkflowNode,
  script: WorkflowNode,
  prompt: WorkflowNode,
}

/**
 * React Flow 只按字符串 key 在运行时查表，这里的断言仅用于收敛
 * 「通用 Node/Edge」与「路由工作台专用 Node/Edge」之间的泛型差异。
 */
export const nodeTypes = workflowNodeTypes as unknown as NodeTypes

export const edgeTypes = { workflow: WorkflowEdge } as unknown as EdgeTypes
