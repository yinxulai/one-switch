import { z } from 'zod'

const LogicalModelContextSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
})

const RequestPayloadSchema = z.object({
  path: z.string().optional(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
}).catchall(z.unknown())

const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const WorkflowNodeBaseSchema = z.object({
  id: z.string(),
  kind: z.enum(['input', 'control-input', 'protocol-discovery', 'condition', 'model-select', 'iteration', 'output']),
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
  valueType: z.enum(['string', 'number', 'boolean', 'enum', 'array', 'object', 'unknown']),
  operator: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn', 'regex', 'gt', 'gte', 'lt', 'lte', 'between', 'isTrue', 'isFalse', 'empty', 'notEmpty', 'exists']),
  // 旧版本保存的图没有这两项，默认按字面量比较。
  valueSource: z.enum(['literal', 'field']).default('literal'),
  valueFieldPath: z.string().default(''),
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

const ModelSelectNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('model-select'),
  // 旧版本保存的图没有这些字段，用默认值补齐，避免历史版本全部失效。
  source: z.enum(['fixed', 'variable']).default('fixed'),
  variablePath: z.string().default(''),
  // 允许空数组：刚插入、尚未选择逻辑模型的节点是合法的编辑中间态，
  // 运行时会产出 success: false 的 trace，而不是让整张图校验失败。
  modelIds: z.array(z.string().min(1)).default([]),
  fallbackModelIds: z.array(z.string().min(1)).default([]),
})

const IterationNodeSchema = WorkflowNodeBaseSchema.extend({
  kind: z.literal('iteration'),
  // 旧版本保存的图没有这些字段，用默认值补齐（与 model-select 的处理保持一致）。
  // 遍历来源：支持通配投影（`logicalModels[*].id`）；数组按元素、对象按键值对遍历。
  sourcePath: z.string().default(''),
  // 每轮结束后读取这条路径判断本轮是否命中；空值视为未命中。
  collectPath: z.string().default('route.modelIds'),
  collectMode: z.enum(['first', 'last', 'list', 'count']).default('first'),
  // 汇总结果写回路径；count 模式写入轮数。
  resultPath: z.string().default('route.modelIds'),
  // 业务预算：轮数上限（全局 MAX_STEPS 是另一层兜底）。
  maxIterations: z.number().int().positive().default(10),
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
  ModelSelectNodeSchema,
  IterationNodeSchema,
  OutputNodeSchema,
])

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1),
  sourceNodeId: z.string().min(1),
  sourcePort: z.string().min(1),
  targetNodeId: z.string().min(1),
})

/**
 * 历史数据迁移：老图与历史版本里的字段名会在这里改写成当前命名，
 * 确保 localStorage 里的工作副本与已保存版本不会因为重命名而失效。
 *
 * - `queue-select` → `model-select`；
 * - `mode: 'follow-request-model'` → `source: 'variable'` + `variablePath`；
 * - `queueIds` / `fallbackQueueIds` → `modelIds` / `fallbackModelIds`。
 */
function migrateGraphInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw

  const graph = raw as Record<string, unknown>
  if (!Array.isArray(graph.nodes)) return raw

  let changed = false
  const nodes = graph.nodes.map((item) => {
    if (!item || typeof item !== 'object') return item
    const node = item as Record<string, unknown>
    if (node.kind !== 'queue-select') return item

    changed = true
    const rest: Record<string, unknown> = { ...node, kind: 'model-select' }
    if ('queueIds' in rest) {
      rest.modelIds = rest.queueIds
      delete rest.queueIds
    }
    if ('fallbackQueueIds' in rest) {
      rest.fallbackModelIds = rest.fallbackQueueIds
      delete rest.fallbackQueueIds
    }

    if (!('mode' in rest)) return rest
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
  logicalModels: z.array(LogicalModelContextSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
