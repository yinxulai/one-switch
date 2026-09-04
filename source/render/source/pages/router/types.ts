import type { Protocol } from '@common/schemas'

export type WorkflowNodeKind = 'input' | 'control-input' | 'protocol-discovery' | 'condition' | 'resolver' | 'iteration' | 'loop' | 'output'

export type WorkflowProtocol = Protocol | 'unknown'

export type SchemaValueType = 'string' | 'number' | 'boolean' | 'enum' | 'unknown'

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

export type ConditionLogicalOperator = 'and' | 'or'

export interface ConditionCase {
  id: string
  name: string
  logicalOperator: ConditionLogicalOperator
  conditions: ConditionRule[]
  next: string
}

export interface ConditionNode extends WorkflowNodeBase {
  kind: 'condition'
  cases: ConditionCase[]
  elseNext: string
}

export interface ResolverMatchRule {
  field: string
  operator: 'equalsInput'
}

export interface ResolverFallback {
  type: 'reference'
  resource: string
  id: string
}

export interface ResolverResolution {
  resource: string
  candidates: { source: 'catalog' | 'ids'; ids?: string[] }
  match: ResolverMatchRule[]
  fallback?: ResolverFallback
}

export interface ResolverNode extends WorkflowNodeBase {
  kind: 'resolver'
  input: { path: string }
  resolution: ResolverResolution
  next: string
}

export interface IterationNode extends WorkflowNodeBase {
  kind: 'iteration'
  input: { path: string }
  bodyNext: string
  next: string
}

export interface LoopNode extends WorkflowNodeBase {
  kind: 'loop'
  maxIterations: number
  condition: ConditionRule
  bodyNext: string
  next: string
}

export interface RuntimeLogicalModel {
  id: string
  name: string
  enabled: boolean
}

export interface RuntimeCandidate {
  id: string
  name?: string
  enabled?: boolean
  resource?: string
}

export interface ResolverDecision {
  selectedId: string | null
  resource: string
  source: 'match' | 'fallback' | 'none'
  matchedRule?: number
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
  | ResolverNode
  | IterationNode
  | LoopNode
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
  resolutions: Record<string, ResolverDecision>
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
  unknown: ['equals', 'notEquals', 'empty', 'notEmpty', 'exists'],
}
