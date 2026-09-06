import type { Protocol } from '@common/schemas'

export type WorkflowNodeKind = 'input' | 'control-input' | 'protocol-discovery' | 'condition' | 'queue-select' | 'output'

export type WorkflowProtocol = Protocol | 'unknown'

export type SchemaValueType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'unknown'

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'in'
  | 'notIn'
  | 'regex'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'isTrue'
  | 'isFalse'
  | 'empty'
  | 'notEmpty'
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

export type WorkflowSourcePort = 'out' | 'body' | 'else' | WorkflowProtocol | (string & {})

export interface WorkflowEdge {
  id: string
  sourceNodeId: string
  sourcePort: WorkflowSourcePort
  targetNodeId: string
}

export interface WorkflowGraph {
  version: 1
  nodes: WorkflowNodeModel[]
  edges: WorkflowEdge[]
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
}

export interface ProtocolDiscoveryNode extends WorkflowNodeBase {
  kind: 'protocol-discovery'
}

export interface ConditionRule {
  fieldPath: string
  valueType: SchemaValueType
  operator: ConditionOperator
  value?: string
  secondaryValue?: string
  enumOptions?: string[]
}

export type ConditionLogicalOperator = 'and' | 'or'

export interface ConditionCase {
  id: string
  name: string
  logicalOperator: ConditionLogicalOperator
  conditions: ConditionRule[]
}

export interface ConditionNode extends WorkflowNodeBase {
  kind: 'condition'
  cases: ConditionCase[]
}

export interface QueueSelectNode extends WorkflowNodeBase {
  kind: 'queue-select'
  queueIds: string[]
  mode?: 'static' | 'rule-based'
  fallbackQueueId?: string
  modelQueueRoutes?: ModelQueueRoute[]
  rules?: QueueRouteRule[]
  conflictStrategy?: 'most-specific' | 'highest-priority'
}

export interface ModelQueueRoute {
  id: string
  modelId: string
  enabled: boolean
  queueIds: string[]
}

export type QueueRouteScope = 'header' | 'model' | 'custom'

export interface QueueRouteRule {
  id: string
  name: string
  enabled: boolean
  priority: number
  scope: QueueRouteScope
  fieldPath: string
  valueType: SchemaValueType
  operator: ConditionOperator
  value?: string
  secondaryValue?: string
  enumOptions?: string[]
  queueIds: string[]
}

export interface RuntimeLogicalModel {
  id: string
  name: string
  enabled: boolean
}

export interface QueueSelection {
  queueIds: string[]
  reason: string
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
  | QueueSelectNode
  | OutputNode

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
  protocol: WorkflowProtocol
  queueSelections: Record<string, QueueSelection>
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
  string: ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn', 'regex', 'empty', 'notEmpty', 'exists'],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'exists'],
  boolean: ['isTrue', 'isFalse', 'equals', 'notEquals', 'exists'],
  enum: ['equals', 'notEquals', 'in', 'notIn', 'exists'],
  array: ['contains', 'notContains', 'empty', 'notEmpty', 'exists'],
  unknown: ['equals', 'notEquals', 'empty', 'notEmpty', 'exists'],
}
