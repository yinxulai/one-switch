import type { Protocol } from '@common/schemas'

export type WorkflowNodeKind = 'input' | 'control-input' | 'protocol-discovery' | 'condition' | 'logical-model-selector' | 'output'

export type WorkflowProtocol = Protocol | 'unknown'

export type SchemaValueType = 'string' | 'number' | 'boolean' | 'enum' | 'unknown'

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'in'
  | 'startsWith'
  | 'regex'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'isTrue'
  | 'isFalse'
  | 'exists'

export interface NodePosition {
  x: number
  y: number
}

export interface WorkflowNodeBase {
  id: string
  kind: WorkflowNodeKind
  name: string
  enabled: boolean
  description: string
  position: NodePosition
}

export interface RouteContext {
  request: Record<string, unknown>
  metadata: Record<string, unknown>
  traceId: string
}

export interface RouteContextInput {
  request: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface RouteContextEnvelope {
  payload: Record<string, unknown>
  context: RouteContext
}

export interface InputNode extends WorkflowNodeBase {
  kind: 'input'
  next: string
}

export type ControlInputKind = 'switch' | 'select'

export interface ControlInputOption {
  label: string
  value: string
}

export interface ControlInputItem {
  id: string
  key: string
  label: string
  kind: ControlInputKind
  enabled: boolean
  defaultValue: string | boolean
  options?: ControlInputOption[]
}

export interface ControlInputNode extends WorkflowNodeBase {
  kind: 'control-input'
  controls: ControlInputItem[]
  next: string
}

export interface ProtocolDiscoveryBranches {
  'openai-completions': string
  'openai-responses': string
  'anthropic-messages': string
  unknown: string
}

export interface ProtocolDiscoveryNode extends WorkflowNodeBase {
  kind: 'protocol-discovery'
  branches: ProtocolDiscoveryBranches
}

export interface ConditionRule {
  fieldPath: string
  valueType: SchemaValueType
  operator: ConditionOperator
  value?: string
  secondaryValue?: string
  enumOptions?: string[]
}

export interface ConditionNode extends WorkflowNodeBase {
  kind: 'condition'
  rule: ConditionRule
  nextTrue: string
  nextFalse: string
}

export interface LogicalModelSelectorNode extends WorkflowNodeBase {
  kind: 'logical-model-selector'
  logicalModelId: string
  next: string
}

export interface OutputNode extends WorkflowNodeBase {
  kind: 'output'
  includeTrace: boolean
  summaryLevel: 'brief' | 'detailed'
}

export type WorkflowNodeModel =
  | InputNode
  | ControlInputNode
  | ProtocolDiscoveryNode
  | ConditionNode
  | LogicalModelSelectorNode
  | OutputNode

export interface LogicalModelDecision {
  selectedModel: string
  targetQueue: string
  matched: boolean
  reason: string
}

export interface WorkflowTrace {
  nodeId: string
  nodeName: string
  kind: WorkflowNodeKind
  success: boolean
  message: string
  details?: Record<string, unknown>
}

export interface WorkflowRunResult {
  outputPayload: unknown
  targetQueue: string | null
  protocol: WorkflowProtocol
  routeDecision: LogicalModelDecision | null
  stopReason: 'output' | 'missing-next' | 'max-steps' | 'error'
  trace: WorkflowTrace[]
}

export interface SchemaFieldDescriptor {
  path: string
  valueType: SchemaValueType
  sourceNodeId: string
  sourcePort: string
  enumOptions?: string[]
}

export interface ConfigHints {
  fields: SchemaFieldDescriptor[]
  recommendedOperators: Record<SchemaValueType, ConditionOperator[]>
}

export const DEFAULT_OPERATOR_SET: Record<SchemaValueType, ConditionOperator[]> = {
  string: ['equals', 'notEquals', 'contains', 'in', 'startsWith', 'regex', 'exists'],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'exists'],
  boolean: ['isTrue', 'isFalse', 'equals', 'notEquals', 'exists'],
  enum: ['equals', 'notEquals', 'in', 'exists'],
  unknown: ['equals', 'notEquals', 'exists'],
}
