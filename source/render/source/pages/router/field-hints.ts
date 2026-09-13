import { ALL_TRANSPORT_KINDS } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { requestShapeOf } from '@common/router/request-shape'
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

/**
 * 输入节点能保证的字段。
 *
 * 全是**不解析请求体就能知道**的东西：请求行、请求头、请求体整体，
 * 以及调用方自带的 `metadata`（内容由调用方定义，引擎只读不写）。
 * 请求体里有什么字段、是什么格式（JSON 对象？字节流？）是**协议**的事，
 * 只有协议发现节点知道 —— 见 `@common/router/request-shape`。
 */
const INPUT_REQUEST_FIELDS: { path: string; valueType: SchemaValueType; noteKey?: UiCatalogKey }[] = [
  { path: 'request.path', valueType: 'string' },
  { path: 'request.method', valueType: 'string' },
  { path: 'request.headers', valueType: 'object', noteKey: 'router.fieldNote.requestHeaders' },
  { path: 'request.body', valueType: 'object', noteKey: 'router.fieldNote.requestBody' },
  { path: 'metadata', valueType: 'object', noteKey: 'router.fieldNote.metadata' },
]

/** 逻辑模型列表的字段名：内容由调用方在运行时注入，示例输入里通常没有这一项。 */
const LOGICAL_MODELS_PATH = 'logicalModels'

/**
 * `RuntimeLogicalModel` 的字段契约（与 `@common/router/types` 一一对应）。
 *
 * 逻辑模型列表是**运行时注入**的：任何静态示例里都不可能有它，
 * 所以这组通配投影只能显式给出，否则默认策略里的 `logicalModels[*].id`
 * 在「比较字段」下拉里根本选不到。
 */
const LOGICAL_MODEL_PROJECTIONS: { key: string; valueType: SchemaValueType }[] = [
  { key: 'id', valueType: 'string' },
  { key: 'name', valueType: 'string' },
  { key: 'enabled', valueType: 'boolean' },
]

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

  // 同一路径被多次声明时，具体类型覆盖 `unknown`：
  // 先声明的多半只是「猜不准」（迭代节点按 collectPath 报回写路径时就还不知道循环体写了什么），
  // 后面真知道类型的节点不该被这个猜测挡住 —— 否则一条按类型收窄的候选表会把它筛掉。
  if (existing.valueType === 'unknown' && field.valueType !== 'unknown') {
    existing.valueType = field.valueType
  }
}

export function resolveInputHints(t: AppTranslator, graph: WorkflowGraph, targetNodeId: string): InputHintResult {
  const models = graph.nodes
  const { connections, upstreamNodeIds } = collectUpstreamConnections(graph, targetNodeId)
  const modelsById = new Map(models.map(model => [model.id, model]))
  const fields: SchemaFieldDescriptor[] = []

  for (const model of models) {
    if (!upstreamNodeIds.has(model.id)) continue

    if (model.kind === 'input') {
      for (const field of INPUT_REQUEST_FIELDS) {
        addUniqueField(fields, {
          path: field.path,
          valueType: field.valueType,
          sourceNodeId: model.id,
          sourcePort: 'context',
          ...(field.noteKey ? { note: t(field.noteKey) } : {}),
        })
      }
      addUniqueField(fields, {
        path: LOGICAL_MODELS_PATH,
        valueType: 'array',
        sourceNodeId: model.id,
        sourcePort: 'context',
        note: t('router.fieldNote.logicalModels'),
      })
      // 通配投影无条件暴露：命中判断（`request.body.model in logicalModels[*].id`）依赖它，
      // 而示例输入里带没带 `logicalModels` 不应该决定这条路径在不在候选表里。
      for (const projection of LOGICAL_MODEL_PROJECTIONS) {
        addUniqueField(fields, {
          path: `${LOGICAL_MODELS_PATH}${PATH_WILDCARD_SUFFIX}.${projection.key}`,
          valueType: projection.valueType,
          sourceNodeId: model.id,
          sourcePort: 'context',
        })
      }
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

      // 请求体字段由**这个节点**给出，而不是输入节点：体里有哪些字段、是什么格式，
      // 只有协议层知道（`/v1/responses` 的消息在 `input` 里，其余协议在 `messages` 里）。
      // 按**连接的端口**取对应协议的声明：连在哪个协议端口上，就是那一条协议解析出的字段。
      // 认不出协议（`unknown`）时一个字段都保证不了，那一条端口就一条字段都不产出。
      for (const protocol of protocolEnumOptions) {
        const shape = requestShapeOf(protocol)
        if (!shape || shape.format !== 'json') continue
        for (const field of shape.fields) {
          addUniqueField(fields, {
            path: field.path,
            valueType: field.valueType,
            sourceNodeId: model.id,
            sourcePort: protocol,
            ...(field.noteKey ? { note: t(field.noteKey) } : {}),
          })
        }
      }
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
