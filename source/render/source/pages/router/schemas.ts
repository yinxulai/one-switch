import { z } from 'zod'

const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const WorkflowNodeBaseSchema = z.object({
  id: z.string(),
  kind: z.enum(['input', 'control-input', 'protocol-discovery', 'condition', 'logical-model-selector', 'output']),
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
  fieldPath: z.string(),
  valueType: z.enum(['string', 'number', 'boolean', 'enum', 'unknown']),
  operator: z.enum(['equals', 'notEquals', 'contains', 'in', 'startsWith', 'regex', 'gt', 'gte', 'lt', 'lte', 'between', 'isTrue', 'isFalse', 'exists']),
  value: z.string().optional(),
  secondaryValue: z.string().optional(),
  enumOptions: z.array(z.string()).optional(),
})

const ConditionNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('condition'),
  rule: ConditionRuleSchema,
  nextTrue: z.string(),
  nextFalse: z.string(),
})

const LogicalModelSelectorNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('logical-model-selector'),
  logicalModelId: z.string(),
  next: z.string(),
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
  LogicalModelSelectorNodeSchema,
  OutputNodeSchema,
])

export const RouteContextInputSchema = z.object({
  request: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
