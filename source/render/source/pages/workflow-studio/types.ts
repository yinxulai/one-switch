export type WorkflowNodeKind = 'input' | 'output' | 'condition' | 'modifier' | 'transformer' | 'queue'

export interface WorkflowNodeBase {
  id: string
  kind: WorkflowNodeKind
  name: string
  enabled: boolean
  description: string
  position: { x: number; y: number }
}

export interface InputNode extends WorkflowNodeBase {
  kind: 'input'
  next: string
}

export interface OutputNode extends WorkflowNodeBase {
  kind: 'output'
}

export interface ConditionNode extends WorkflowNodeBase {
  kind: 'condition'
  path: string
  operator: 'eq' | 'contains' | 'gt' | 'exists'
  value: string
  nextTrue: string
  nextFalse: string
}

export interface ModifierNode extends WorkflowNodeBase {
  kind: 'modifier'
  path: string
  value: string
  next: string
}

export interface TransformerNode extends WorkflowNodeBase {
  kind: 'transformer'
  fromPath: string
  toPath: string
  mode: 'trim' | 'uppercase' | 'lowercase' | 'stringify'
  next: string
}

export interface QueueNode extends WorkflowNodeBase {
  kind: 'queue'
  queueId: string
  next: string
}

export type WorkflowNodeModel = InputNode | OutputNode | ConditionNode | ModifierNode | TransformerNode | QueueNode

export interface WorkflowTrace {
  nodeId: string
  nodeName: string
  kind: WorkflowNodeKind
  success: boolean
  message: string
}

export interface WorkflowRunResult {
  outputPayload: unknown
  targetQueue: string | null
  stopReason: 'output' | 'missing-next' | 'max-steps' | 'error'
  trace: WorkflowTrace[]
}
