export type WorkflowNodeKind = 'input' | 'output' | 'condition' | 'filter' | 'modifier' | 'transformer' | 'json-edit' | 'text-replace' | 'note' | 'queue'

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
  operator: 'eq' | 'neq' | 'contains' | 'startsWith' | 'gt' | 'exists' | 'regex'
  value: string
  nextTrue: string
  nextFalse: string
}

export interface FilterNode extends WorkflowNodeBase {
  kind: 'filter'
  path: string
  mode: 'contains' | 'eq' | 'regex' | 'in-list'
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

export interface JsonEditNode extends WorkflowNodeBase {
  kind: 'json-edit'
  path: string
  operation: 'set' | 'remove' | 'merge'
  value: string
  next: string
}

export interface TextReplaceNode extends WorkflowNodeBase {
  kind: 'text-replace'
  path: string
  search: string
  replace: string
  useRegex: boolean
  regexFlags: string
  next: string
}

export interface NoteNode extends WorkflowNodeBase {
  kind: 'note'
  content: string
}

export interface QueueNode extends WorkflowNodeBase {
  kind: 'queue'
  queueId: string
  candidateQueues: string[]
  taskPath: string
  taskOperator: 'none' | 'contains' | 'eq' | 'regex'
  taskValue: string
  taskMissQueueId: string
  next: string
}

export type WorkflowNodeModel = InputNode | OutputNode | ConditionNode | FilterNode | ModifierNode | TransformerNode | JsonEditNode | TextReplaceNode | NoteNode | QueueNode

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
