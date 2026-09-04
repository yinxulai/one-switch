import { z } from 'zod'

const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const WorkflowNodeBaseSchema = z.object({
  id: z.string(),
  kind: z.enum(['input', 'control-input', 'protocol-discovery', 'condition', 'resolver', 'iteration', 'loop', 'output']),
  name: z.string(),
  enabled: z.boolean(),
  description: z.string(),
  position: NodePositionSchema,
})

const ControlInputOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
})

const ControlInputItemSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  kind: z.enum(['switch', 'select']),
  enabled: z.boolean(),
  defaultValue: z.union([z.string(), z.boolean()]),
  options: z.array(ControlInputOptionSchema).optional(),
})

const InputNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('input'),
  next: z.string(),
})

const ControlInputNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('control-input'),
  controls: z.array(ControlInputItemSchema),
  next: z.string(),
})

const ProtocolDiscoveryNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('protocol-discovery'),
  branches: z.object({
    'openai-completions': z.string(),
    'openai-responses': z.string(),
    'anthropic-messages': z.string(),
    unknown: z.string(),
  }),
})

const ConditionRuleSchema = z.object({
  fieldPath: z.string().min(1),
  valueType: z.enum(['string', 'number', 'boolean', 'enum', 'unknown']),
  operator: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn', 'regex', 'gt', 'gte', 'lt', 'lte', 'between', 'isTrue', 'isFalse', 'empty', 'notEmpty', 'exists']),
  value: z.string().optional(),
  secondaryValue: z.string().optional(),
  enumOptions: z.array(z.string()).optional(),
})

const ConditionCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  logicalOperator: z.enum(['and', 'or']),
  conditions: z.array(ConditionRuleSchema).min(1),
  next: z.string().min(1),
})

const ConditionNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('condition'),
  cases: z.array(ConditionCaseSchema).min(1),
  elseNext: z.string(),
})

const ResolverMatchRuleSchema = z.object({
  field: z.string().min(1),
  operator: z.literal('equalsInput'),
})

const ResolverNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('resolver'),
  input: z.object({ path: z.string().min(1) }),
  resolution: z.object({
    resource: z.string().min(1),
    candidates: z.union([
      z.object({ source: z.literal('catalog') }),
      z.object({ source: z.literal('ids'), ids: z.array(z.string().min(1)).min(1) }),
    ]),
    match: z.array(ResolverMatchRuleSchema).min(1),
    fallback: z.object({
      type: z.literal('reference'),
      resource: z.string().min(1),
      id: z.string().min(1),
    }).optional(),
  }),
  next: z.string(),
})

const IterationNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('iteration'),
  input: z.object({ path: z.string().min(1) }),
  bodyNext: z.string().min(1),
  next: z.string().min(1),
})

const LoopNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('loop'),
  maxIterations: z.number().int().min(1).max(1000),
  condition: ConditionRuleSchema,
  bodyNext: z.string().min(1),
  next: z.string().min(1),
})

const OutputNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('output'),
  includeTrace: z.boolean(),
  summaryLevel: z.enum(['brief', 'detailed']),
})

export const WorkflowNodeModelSchema = z.discriminatedUnion('kind', [
  InputNodeSchema,
  ControlInputNodeSchema,
  ProtocolDiscoveryNodeSchema,
  ConditionNodeSchema,
  ResolverNodeSchema,
  IterationNodeSchema,
  LoopNodeSchema,
  OutputNodeSchema,
])

export const RouteContextInputSchema = z.object({
  request: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
