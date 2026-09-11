import { z } from 'zod'

const HeaderValueSchema = z.union([z.string(), z.array(z.string())])

const WorkflowQueueContextSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
})

const RequestPayloadSchema = z.object({
  path: z.string().optional(),
  method: z.string().optional(),
  headers: z.record(z.string(), HeaderValueSchema).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
}).catchall(z.unknown())

const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const WorkflowNodeBaseSchema = z.object({
  id: z.string(),
  kind: z.enum(['input', 'control-input', 'protocol-discovery', 'condition', 'queue-select', 'output']),
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
})

const ControlInputNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('control-input'),
  controls: z.array(ControlInputItemSchema),
})

const ProtocolDiscoveryNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('protocol-discovery'),
})

const ConditionRuleSchema = z.object({
  fieldPath: z.string().min(1),
  valueType: z.enum(['string', 'number', 'boolean', 'enum', 'array', 'unknown']),
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
})

const ConditionNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('condition'),
  cases: z.array(ConditionCaseSchema).min(1),
})

const QueueSelectNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('queue-select'),
  // 旧版本保存的图没有这些字段，用默认值补齐，避免历史版本全部失效。
  source: z.enum(['fixed', 'variable']).default('fixed'),
  variablePath: z.string().default(''),
  // 允许空数组：刚插入、尚未选择队列的节点是合法的编辑中间态，
  // 运行时会产出 success: false 的 trace，而不是让整张图校验失败。
  queueIds: z.array(z.string().min(1)).default([]),
  fallbackQueueIds: z.array(z.string().min(1)).default([]),
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
  QueueSelectNodeSchema,
  OutputNodeSchema,
])

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  sourcePort: z.string().min(1),
  targetNodeId: z.string().min(1),
})

/**
 * 历史数据迁移：早期队列选择节点用 `mode` 表达取值方式，
 * 现在统一为 `source` + `variablePath`。
 * 在这里做一次字段改写，老图与历史版本就能继续通过校验、行为保持不变。
 */
function migrateGraphInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw

  const graph = raw as Record<string, unknown>
  if (!Array.isArray(graph.nodes)) return raw

  let changed = false
  const nodes = graph.nodes.map((item) => {
    if (!item || typeof item !== 'object') return item
    const node = item as Record<string, unknown>
    if (node.kind !== 'queue-select' || !('mode' in node)) return item

    changed = true
    const rest: Record<string, unknown> = { ...node }
    delete rest.mode
    if (node.mode === 'follow-request-model') {
      return { ...rest, source: 'variable', variablePath: 'route.requestedModel' }
    }
    return { ...rest, source: 'fixed' }
  })

  return changed ? { ...graph, nodes } : raw
}

export const WorkflowGraphSchema = z.preprocess(migrateGraphInput, z.object({
  version: z.literal(1),
  nodes: z.array(WorkflowNodeModelSchema),
  edges: z.array(WorkflowEdgeSchema),
}))

export const RouteContextInputSchema = z.object({
  request: RequestPayloadSchema,
  queues: z.array(WorkflowQueueContextSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
