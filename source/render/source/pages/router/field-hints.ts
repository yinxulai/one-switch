import { ALL_TRANSPORT_KINDS } from '@common/schemas'
import {
  ALL_WORKFLOW_PROTOCOLS,
  DEFAULT_OPERATOR_SET,
  PATH_WILDCARD_SUFFIX,
  type ConfigHints,
  type SchemaFieldDescriptor,
  type SchemaValueType,
  type WorkflowGraph,
  type WorkflowProtocol,
} from '@common/router/types'
import type { AppTranslator } from '@/i18n/provider'

export interface WorkflowConnection {
  sourceNodeId: string
  sourcePort: string
  targetNodeId: string
}

export interface InputHintResult extends ConfigHints {
  upstreamNodeIds: string[]
}

export function buildWorkflowConnections(graph: WorkflowGraph): WorkflowConnection[] {
  return graph.edges.map(edge => ({
    sourceNodeId: edge.sourceNodeId,
    sourcePort: edge.sourcePort,
    targetNodeId: edge.targetNodeId,
  }))
}

function inferType(value: unknown): SchemaValueType {
  if (Array.isArray(value)) return 'array'
  if (value && typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'unknown'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 按「整体字段」暴露、不再往里展开的路径。
 * `request.headers` 是扁平的字符串字典（`Record<string, string>`），
 * 展开成 `request.headers.x-provider` 既不准也没意义。
 */
const OPAQUE_PATHS = new Set(['request.headers'])

/** 展开递归深度上限，防止深层嵌套数据把候选列表撑爆。 */
const MAX_FLATTEN_DEPTH = 4

/** 数组采样上限：只看前若干条推断元素结构。 */
const MAX_ARRAY_SAMPLE = 20

function flattenFields(t: AppTranslator, source: unknown, prefix: string, sourceNodeId: string, sourcePort: string, depth = 0): SchemaFieldDescriptor[] {
  if (!isPlainObject(source)) {
    return prefix
      ? [{ path: prefix, valueType: inferType(source), sourceNodeId, sourcePort }]
      : []
  }

  const fields: SchemaFieldDescriptor[] = []
  for (const [key, value] of Object.entries(source)) {
    const nextPath = prefix ? `${prefix}.${key}` : key
    if (Array.isArray(value)) {
      fields.push(...flattenArrayFields(t, value, nextPath, sourceNodeId, sourcePort, depth))
      continue
    }
    if (isPlainObject(value) && !OPAQUE_PATHS.has(nextPath)) {
      // 对象字段同时给出「整体」和「细化」两种选择：
      // 整体用于 `empty` / `notEmpty` / `contains`（按键名）这类整块判断，
      // 细化用于逐字段比较。数组也走同一套「整体 + 通配投影」约定。
      fields.push({
        path: nextPath,
        valueType: 'object',
        sourceNodeId,
        sourcePort,
        note: t('router.fieldNote.object'),
      })
      fields.push(...flattenFields(t, value, nextPath, sourceNodeId, sourcePort, depth + 1))
      continue
    }
    fields.push({
      path: nextPath,
      valueType: inferType(value),
      sourceNodeId,
      sourcePort,
    })
  }
  return fields
}

/**
 * 数组字段的展开策略（「判断对象或者数组内容」用得上）：
 * - 元素是对象 → 额外展开出 `path[*].key` 形式的通配投影字段，
 *   引擎按元素取值后再取字段，条件判断表里就能直接选到「每个元素的某个属性」；
 * - 元素不是对象 / 采不到样本 → 只留一个 `array` 字段，
 *   交给 `contains`、`empty`、`notEmpty` 对整体判定。
 */
function flattenArrayFields(t: AppTranslator, items: unknown[], prefix: string, sourceNodeId: string, sourcePort: string, depth: number): SchemaFieldDescriptor[] {
  const arrayField: SchemaFieldDescriptor = { path: prefix, valueType: 'array', sourceNodeId, sourcePort }
  if (items.length === 0 || depth >= MAX_FLATTEN_DEPTH) return [arrayField]

  // 元素结构可能不一致：把可采样到的对象元素的键并起来，尽量不漏字段。
  const merged: Record<string, unknown> = {}
  for (const item of items.slice(0, MAX_ARRAY_SAMPLE)) {
    if (!isPlainObject(item)) continue
    for (const [key, value] of Object.entries(item)) {
      if (!(key in merged)) merged[key] = value
    }
  }
  if (Object.keys(merged).length === 0) return [arrayField]

  const wildcardPath = `${prefix}${PATH_WILDCARD_SUFFIX}`
  const fields: SchemaFieldDescriptor[] = [
    { ...arrayField, note: t('router.fieldNote.array') },
  ]
  for (const [key, value] of Object.entries(merged)) {
    const nextPath = `${wildcardPath}.${key}`
    if (Array.isArray(value)) {
      fields.push(...flattenArrayFields(t, value, nextPath, sourceNodeId, sourcePort, depth + 1))
      continue
    }
    if (isPlainObject(value)) {
      fields.push(...flattenFields(t, value, nextPath, sourceNodeId, sourcePort, depth + 1))
      continue
    }
    fields.push({ path: nextPath, valueType: inferType(value), sourceNodeId, sourcePort })
  }
  return fields
}

function collectUpstreamConnections(graph: WorkflowGraph, targetNodeId: string): {
  connections: WorkflowConnection[]
  upstreamNodeIds: Set<string>
} {
  const knownNodeIds = new Set(graph.nodes.map(model => model.id))
  const incoming = new Map<string, WorkflowConnection[]>()

  for (const connection of buildWorkflowConnections(graph)) {
    if (!knownNodeIds.has(connection.targetNodeId)) continue
    const targetConnections = incoming.get(connection.targetNodeId) ?? []
    targetConnections.push(connection)
    incoming.set(connection.targetNodeId, targetConnections)
  }

  const upstreamConnections: WorkflowConnection[] = []
  const upstreamNodeIds = new Set<string>()
  const visitedTargets = new Set([targetNodeId])
  const pendingTargets = [targetNodeId]

  while (pendingTargets.length > 0) {
    const currentTarget = pendingTargets.shift()
    if (!currentTarget) continue

    for (const connection of incoming.get(currentTarget) ?? []) {
      upstreamConnections.push(connection)
      upstreamNodeIds.add(connection.sourceNodeId)
      if (visitedTargets.has(connection.sourceNodeId)) continue
      visitedTargets.add(connection.sourceNodeId)
      pendingTargets.push(connection.sourceNodeId)
    }
  }

  upstreamNodeIds.delete(targetNodeId)
  return { connections: upstreamConnections, upstreamNodeIds }
}

function addUniqueField(fields: SchemaFieldDescriptor[], field: SchemaFieldDescriptor): void {
  const existing = fields.find(item => item.path === field.path)
  if (!existing) {
    fields.push(field)
    return
  }

  if (existing.valueType === 'enum' && field.valueType === 'enum') {
    existing.enumOptions = [...new Set([...(existing.enumOptions ?? []), ...(field.enumOptions ?? [])])]
  }
}

export function resolveInputHints(t: AppTranslator, graph: WorkflowGraph, targetNodeId: string, samplePayload: unknown): InputHintResult {
  const models = graph.nodes
  const { connections, upstreamNodeIds } = collectUpstreamConnections(graph, targetNodeId)
  const modelsById = new Map(models.map(model => [model.id, model]))
  const fields: SchemaFieldDescriptor[] = []

  for (const model of models) {
    if (!upstreamNodeIds.has(model.id)) continue

    if (model.kind === 'input') {
      for (const field of flattenFields(t, samplePayload, '', model.id, 'context')) addUniqueField(fields, field)
      addUniqueField(fields, {
        path: 'logicalModels',
        valueType: 'array',
        sourceNodeId: model.id,
        sourcePort: 'context',
        note: t('router.fieldNote.logicalModels'),
      })
      addUniqueField(fields, {
        path: 'route.requestedModel',
        valueType: 'string',
        sourceNodeId: model.id,
        sourcePort: 'context',
      })
      continue
    }

    if (!model.enabled) continue

    if (model.kind === 'control-input') {
      for (const control of model.controls) {
        if (!control.enabled) continue
        addUniqueField(fields, {
          path: `route.controls.${control.key}`,
          valueType: control.kind === 'switch' ? 'boolean' : 'enum',
          sourceNodeId: model.id,
          sourcePort: control.id,
          enumOptions: control.kind === 'select' && control.options
            ? control.options.map(option => option.value)
            : undefined,
        })
      }
      continue
    }

    if (model.kind === 'protocol-discovery') {
      const reachablePorts = connections
        .filter(connection => connection.sourceNodeId === model.id)
        .map(connection => connection.sourcePort)
      const reachableProtocols = reachablePorts
        .filter((protocol): protocol is WorkflowProtocol => ALL_WORKFLOW_PROTOCOLS.includes(protocol as WorkflowProtocol))
      const protocolEnumOptions = [...new Set(reachableProtocols)]

      addUniqueField(fields, {
        path: 'route.protocol',
        valueType: 'enum',
        sourceNodeId: model.id,
        sourcePort: 'protocol',
        enumOptions: protocolEnumOptions,
      })
      // 传输形态是随请求一起进来的确凿事实，不是这个节点「发现」出来的；
      // 这里只是把它告诉下游条件节点。枚举直接取引擎承认的取值集合，
      // 所以带上这一版还没接上的 `websocket` —— 规则可以先按它写好，WS 入口落地时图不必改。
      // 只有这一根轴：连接方式就是端点 URL 的 scheme，不再是一个能单独给值的字段。
      addUniqueField(fields, {
        path: 'route.transport',
        valueType: 'enum',
        sourceNodeId: model.id,
        sourcePort: 'context',
        enumOptions: [...ALL_TRANSPORT_KINDS],
      })
      continue
    }

    if (model.kind === 'model-select') {
      addUniqueField(fields, {
        path: 'route.modelIds',
        valueType: 'array',
        sourceNodeId: model.id,
        sourcePort: 'out',
      })
      addUniqueField(fields, {
        path: 'route.fallback',
        valueType: 'boolean',
        sourceNodeId: model.id,
        sourcePort: 'out',
      })
      continue
    }

    if (model.kind === 'iteration') {
      // 循环体里的条件判断靠这组作用域字段：`route.iteration.*` 每轮都会被重写。
      // `item` 的静态类型跟着 `sourcePath` 指向的字段走，能在候选表里给出更准的操作符集合。
      const sourcePath = model.sourcePath.trim()
      const sourceField = sourcePath ? fields.find(field => field.path === sourcePath) : undefined
      const itemType: SchemaValueType = sourceField && sourceField.valueType !== 'array' ? sourceField.valueType : 'unknown'

      addUniqueField(fields, {
        path: 'route.iteration.item',
        valueType: itemType,
        sourceNodeId: model.id,
        sourcePort: 'body',
        note: sourcePath ? t('router.fieldNote.iterationItemFrom', { path: sourcePath }) : t('router.fieldNote.iterationItemPending'),
      })
      addUniqueField(fields, {
        path: 'route.iteration.index',
        valueType: 'number',
        sourceNodeId: model.id,
        sourcePort: 'body',
        note: t('router.fieldNote.iterationIndex'),
      })
      addUniqueField(fields, {
        path: 'route.iteration.key',
        valueType: 'string',
        sourceNodeId: model.id,
        sourcePort: 'body',
        note: t('router.fieldNote.iterationKey'),
      })
      addUniqueField(fields, {
        path: 'route.iteration.total',
        valueType: 'number',
        sourceNodeId: model.id,
        sourcePort: 'body',
        note: t('router.fieldNote.iterationTotal'),
      })

      const resultPath = model.resultPath.trim()
      if (resultPath) {
        addUniqueField(fields, {
          path: resultPath,
          valueType: 'unknown',
          sourceNodeId: model.id,
          sourcePort: 'out',
          note: t('router.fieldNote.iterationResult'),
        })
      }

      const collectPath = model.collectPath.trim()
      if (collectPath) {
        const collectField = fields.find(field => field.path === collectPath)
        addUniqueField(fields, {
          path: collectPath,
          valueType: collectField?.valueType ?? 'unknown',
          sourceNodeId: model.id,
          sourcePort: 'out',
          note: t('router.fieldNote.iterationCollect'),
        })
      }
      continue
    }

    if (model.kind === 'script') {
      // 脚本产出什么类型完全取决于脚本内容，所以静态类型给 unknown：
      // unknown 在下游条件节点里不限制操作符，由运行时的真实取值决定语义。
      const resultPath = model.resultPath.trim()
      if (resultPath) {
        addUniqueField(fields, {
          path: resultPath,
          valueType: 'unknown',
          sourceNodeId: model.id,
          sourcePort: 'out',
          note: t('router.fieldNote.scriptResult'),
        })
      }
      continue
    }

    if (model.kind === 'prompt') {
      const resultPath = model.resultPath.trim()
      if (resultPath) {
        addUniqueField(fields, {
          path: resultPath,
          valueType: 'string',
          sourceNodeId: model.id,
          sourcePort: 'out',
          note: t('router.fieldNote.promptResult'),
        })
      }
      continue
    }
  }

  return {
    fields,
    recommendedOperators: DEFAULT_OPERATOR_SET,
    upstreamNodeIds: [...upstreamNodeIds].filter(nodeId => modelsById.has(nodeId)),
  }
}
