import { MarkerType, type Edge } from '@xyflow/react'

import {
  NODE_KIND_ORDER,
  edgeRunStatusStroke,
  edgeStrokeColor,
  type AppendableKind,
} from './node-meta'
import type { NodeRunStatus } from './node-data'
import {
  DEFAULT_MODEL_IDS,
  DEFAULT_OPERATOR_SET,
  PROMPT_TIMEOUT_DEFAULT,
  SCRIPT_TIMEOUT_DEFAULT,
  type ConditionCase,
  type ConditionOperator,
  type ConditionRule,
  type ControlInputItem,
  type ControlInputKind,
  type NodePosition,
  type SchemaValueType,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowNodeModel,
} from './types'

export const routerStorageKey = 'one-switch.router.graph.v1'

/**
 * 测试运行用的示例原始输入。
 * 保持最小形态：只有路由真正会读到的请求事实（路径 / 方法 / 头 / 体），
 * 不再预置业务字段。`logicalModels` 由页面在运行时注入真实模型列表。
 */
export const samplePayload = {
  request: {
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-provider': 'openai',
    },
    body: {
      model: 'gpt-4o-mini',
      tenant: 'vip-cn',
    },
  },
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
}

export function createConditionRule(): ConditionRule {
  return {
    fieldPath: 'request.body.tenant',
    valueType: 'string',
    operator: 'startsWith',
    valueSource: 'literal',
    valueFieldPath: '',
    value: 'vip-',
  }
}

export function createConditionCase(id: string = createId('case')): ConditionCase {
  return {
    id,
    name: '分支 1',
    logicalOperator: 'and',
    conditions: [createConditionRule()],
  }
}

export function createControlItem(kind: ControlInputKind): ControlInputItem {
  if (kind === 'switch') {
    return {
      id: createId('control'),
      key: 'featureEnabled',
      label: '功能开关',
      kind,
      enabled: true,
      defaultValue: true,
    }
  }

  return {
    id: createId('control'),
    key: 'routeMode',
    label: '路由模式',
    kind,
    enabled: true,
    defaultValue: 'balanced',
    options: [
      { label: 'Balanced', value: 'balanced' },
      { label: 'Fast', value: 'fast' },
      { label: 'Strict', value: 'strict' },
    ],
  }
}

export function createNodeByKind(kind: AppendableKind, position: NodePosition): WorkflowNodeModel {
  const id = createId(kind)

  if (kind === 'control-input') {
    return {
      id,
      kind,
      name: '控制输入节点',
      enabled: true,
      description: '注入开关与下拉等系统控制值。',
      position,
      controls: [createControlItem('switch')],
    }
  }

  if (kind === 'protocol-discovery') {
    return {
      id,
      kind,
      name: '协议发现节点',
      enabled: true,
      description: '输入 request，输出协议分支。',
      position,
    }
  }

  if (kind === 'condition') {
    return {
      id,
      kind,
      name: '条件节点',
      enabled: true,
      description: '按类型感知条件做 IF / ELSE 多分支。',
      position,
      cases: [createConditionCase()],
    }
  }

  if (kind === 'iteration') {
    return {
      id,
      kind,
      name: '遍历迭代节点',
      enabled: true,
      description: '遍历数组 / 对象，逐项执行循环体并汇总结果。',
      position,
      sourcePath: 'logicalModels',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: 'route.modelIds',
      maxIterations: 10,
    }
  }

  if (kind === 'script') {
    return {
      id,
      kind,
      name: 'JS 脚本节点',
      enabled: true,
      description: '在沙箱里跑一段 JS，把结果写回运行数据。',
      position,
      code: '// payload 是本次运行数据的深拷贝，get(路径) 支持 a[*].b 通配投影\nreturn get(\'logicalModels[*].id\') || []',
      resultPath: 'route.scriptResult',
      timeoutMilliseconds: SCRIPT_TIMEOUT_DEFAULT,
    }
  }

  if (kind === 'prompt') {
    return {
      id,
      kind,
      name: 'LLM 节点',
      enabled: true,
      description: '用指定逻辑模型执行提示词，回复写回运行数据。',
      position,
      logicalModelId: '',
      systemPrompt: '',
      promptTemplate: '请从 ${logicalModels[*].id} 里挑一个最适合当前请求的逻辑模型，只回答 id。',
      resultPath: 'route.promptResult',
      temperature: 0.7,
      maxTokens: 1_024,
      timeoutMilliseconds: PROMPT_TIMEOUT_DEFAULT,
    }
  }

  return {
    id,
    kind: 'model-select',
    name: '逻辑模型选择节点',
    enabled: true,
    description: '选择一个或多个逻辑模型，交由出口执行。',
    position,
    source: 'fixed',
    variablePath: '',
    modelIds: [],
    fallbackModelIds: [],
  }
}

const fixedNodeCopy = {
  input: {
    name: '输入请求',
    description: '固定入口节点：接收原始请求并开始路由。',
  },
  output: {
    name: '路由结果出口',
    description: '固定出口节点：输出路由结果并交由代理执行。',
  },
} as const

export function withFixedNodeCopy(nodes: WorkflowNodeModel[]): WorkflowNodeModel[] {
  let changed = false
  const next = nodes.map(node => {
    if (node.kind !== 'input' && node.kind !== 'output') return node
    const fixed = node.kind === 'input' ? fixedNodeCopy.input : fixedNodeCopy.output
    if (node.name === fixed.name && node.description === fixed.description) return node
    changed = true
    return { ...node, name: fixed.name, description: fixed.description }
  })
  return changed ? next : nodes
}

/* ------------------------------------------------------------------------- *
 * 策略预设
 * ------------------------------------------------------------------------- */

/** 固定入口节点（input / output）的名称与描述不可修改。 */
export function createInputNode(position: NodePosition): WorkflowNodeModel {
  return {
    id: 'input',
    kind: 'input',
    name: fixedNodeCopy.input.name,
    enabled: true,
    description: fixedNodeCopy.input.description,
    position,
  }
}

/** 固定出口节点（不受保护的固定节点使用同一份文案）。 */
export function createOutputNode(position: NodePosition): WorkflowNodeModel {
  return {
    id: 'output',
    kind: 'output',
    name: fixedNodeCopy.output.name,
    enabled: true,
    description: fixedNodeCopy.output.description,
    position,
    includeTrace: true,
    summaryLevel: 'detailed',
  }
}

/**
 * 默认策略：请求模型命中逻辑模型 id 就直连它，否则落到默认逻辑模型。
 *
 * 规则全部由基础节点组合而成，没有任何专用节点，
 * 命中判断就是一条普通的「字段 in 字段」条件：
 * 输入 → 条件（route.requestedModel in logicalModels[*].id）
 *        ├─ IF   → 逻辑模型选择（变量取值 route.requestedModel）→ 出口
 *        └─ ELSE → 逻辑模型选择（固定 default）→ 出口
 *
 * 注意比较右侧用的是通配投影 `logicalModels[*].id`：
 * 上下文里本来就带着完整的逻辑模型列表，没必要再派生一份 id 数组。
 */
export function createDefaultPolicyGraph(): WorkflowGraph {
  const conditionCase: ConditionCase = {
    ...createConditionCase('case-1'),
    name: '请求模型在逻辑模型列表里',
    conditions: [
      {
        fieldPath: 'route.requestedModel',
        valueType: 'string',
        operator: 'in',
        valueSource: 'field',
        valueFieldPath: 'logicalModels[*].id',
      },
    ],
  }

  return {
    version: 1,
    nodes: [
      createInputNode({ x: 80, y: 220 }),
      {
        id: 'condition',
        kind: 'condition',
        name: '请求模型是否命中逻辑模型',
        enabled: true,
        description: 'route.requestedModel 在 logicalModels[*].id 里时走直连分支，否则落到默认逻辑模型。',
        position: { x: 460, y: 220 },
        cases: [conditionCase],
      },
      {
        id: 'model-direct',
        kind: 'model-select',
        name: '直连请求模型',
        enabled: true,
        description: '把 route.requestedModel 的取值直接当作逻辑模型 id。',
        position: { x: 860, y: 110 },
        source: 'variable',
        variablePath: 'route.requestedModel',
        modelIds: [],
        fallbackModelIds: [],
      },
      {
        id: 'model-default',
        kind: 'model-select',
        name: '默认逻辑模型',
        enabled: true,
        description: '未命中时落到内置的默认逻辑模型。',
        position: { x: 860, y: 330 },
        source: 'fixed',
        variablePath: '',
        modelIds: [...DEFAULT_MODEL_IDS],
        fallbackModelIds: [],
      },
      createOutputNode({ x: 1260, y: 220 }),
    ],
    edges: [
      { id: 'edge-input-condition', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'condition' },
      { id: 'edge-condition-direct', sourceNodeId: 'condition', sourcePort: conditionCase.id, targetNodeId: 'model-direct' },
      { id: 'edge-condition-else', sourceNodeId: 'condition', sourcePort: 'else', targetNodeId: 'model-default' },
      { id: 'edge-model-direct-output', sourceNodeId: 'model-direct', sourcePort: 'out', targetNodeId: 'output' },
      { id: 'edge-model-default-output', sourceNodeId: 'model-default', sourcePort: 'out', targetNodeId: 'output' },
    ],
  }
}

/** 协议分流模板：先识别协议，再按条件分流，最后落到不同逻辑模型。 */
export function createDefaultGraph(): WorkflowGraph {
  // 分支 id 固定，保证同一预设每次生成的图完全一致（否则「当前策略」永远匹配不上）。
  const conditionCase = createConditionCase('case-1')
  const nodes: WorkflowNodeModel[] = [
    createInputNode({ x: 80, y: 220 }),
    {
      id: 'protocol',
      kind: 'protocol-discovery',
      name: '协议发现',
      enabled: true,
      description: '输入 request，输出协议分支。',
      position: { x: 420, y: 220 },
    },
    {
      id: 'condition',
      kind: 'condition',
      name: '条件分支',
      enabled: true,
      description: '按类型感知条件执行 IF / ELSE 多分支。',
      position: { x: 760, y: 220 },
      cases: [conditionCase],
    },
    {
      id: 'model',
      kind: 'model-select',
      name: '逻辑模型选择',
      enabled: true,
      description: '选择一个或多个逻辑模型，交由出口执行。',
      position: { x: 1100, y: 220 },
      source: 'fixed',
      variablePath: '',
      modelIds: [],
      fallbackModelIds: [],
    },
    createOutputNode({ x: 1440, y: 220 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-protocol', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' },
    { id: 'edge-protocol-completions', sourceNodeId: 'protocol', sourcePort: 'openai-completions', targetNodeId: 'condition' },
    { id: 'edge-protocol-responses', sourceNodeId: 'protocol', sourcePort: 'openai-responses', targetNodeId: 'condition' },
    { id: 'edge-protocol-anthropic', sourceNodeId: 'protocol', sourcePort: 'anthropic-messages', targetNodeId: 'condition' },
    { id: 'edge-protocol-unknown', sourceNodeId: 'protocol', sourcePort: 'unknown', targetNodeId: 'model' },
    { id: 'edge-condition-case', sourceNodeId: 'condition', sourcePort: conditionCase.id, targetNodeId: 'model' },
    { id: 'edge-condition-else', sourceNodeId: 'condition', sourcePort: 'else', targetNodeId: 'model' },
    { id: 'edge-model-output', sourceNodeId: 'model', sourcePort: 'out', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

export interface RouterPolicyPreset {
  id: string
  name: string
  description: string
  /** 是否是系统内建的默认策略（列表第一项，可在任何时刻一键选回）。 */
  isDefault: boolean
  createGraph: () => WorkflowGraph
}

/**
 * 遍历迭代模板：逐个检查逻辑模型，挑出第一个启用的。
 *
 * 展示迭代节点的完整用法：
 * - `body` 端口进循环体（条件判定），循环体末端连回迭代节点即「本轮结束」；
 * - `route.iteration.item` 是当前轮元素，可以继续取字段（`route.iteration.item.id`）；
 * - `collectMode: 'first'` 表示首次命中就收工，`collectPath` 读的是本轮结果。
 */
export function createIterationGraph(): WorkflowGraph {
  const iterationCase: ConditionCase = {
    id: 'case-1',
    name: '本轮模型已启用',
    logicalOperator: 'and',
    conditions: [
      {
        fieldPath: 'route.iteration.item.enabled',
        valueType: 'boolean',
        operator: 'isTrue',
        valueSource: 'literal',
        valueFieldPath: '',
        value: '',
      },
    ],
  }

  const nodes: WorkflowNodeModel[] = [
    createInputNode({ x: 80, y: 320 }),
    {
      id: 'iteration',
      kind: 'iteration',
      name: '遍历逻辑模型',
      enabled: true,
      description: '逐个遍历 logicalModels，找出第一个启用中的模型。',
      position: { x: 440, y: 320 },
      sourcePath: 'logicalModels',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: 'route.modelIds',
      maxIterations: 10,
    },
    {
      id: 'iteration-condition',
      kind: 'condition',
      name: '本轮模型是否启用',
      enabled: true,
      description: '读取 route.iteration.item.enabled，命中说明本轮可用。',
      position: { x: 800, y: 140 },
      cases: [iterationCase],
    },
    {
      id: 'iteration-model',
      kind: 'model-select',
      name: '取本轮模型 id',
      enabled: true,
      description: '把 route.iteration.item.id 当成本轮落点逻辑模型。',
      position: { x: 1160, y: 40 },
      source: 'variable',
      variablePath: 'route.iteration.item.id',
      modelIds: [],
      fallbackModelIds: [],
    },
    createOutputNode({ x: 1160, y: 480 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-iteration', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'iteration' },
    { id: 'edge-iteration-body', sourceNodeId: 'iteration', sourcePort: 'body', targetNodeId: 'iteration-condition' },
    { id: 'edge-iteration-case', sourceNodeId: 'iteration-condition', sourcePort: iterationCase.id, targetNodeId: 'iteration-model' },
    // 循环体末端连回迭代节点：这一条边代表「本轮结束」，不是死循环。
    { id: 'edge-iteration-model-back', sourceNodeId: 'iteration-model', sourcePort: 'out', targetNodeId: 'iteration' },
    { id: 'edge-iteration-else-back', sourceNodeId: 'iteration-condition', sourcePort: 'else', targetNodeId: 'iteration' },
    { id: 'edge-iteration-output', sourceNodeId: 'iteration', sourcePort: 'out', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

/** 策略预设：一键把画布换成某种内置规则，随时可切回默认策略。 */
export const ROUTER_POLICY_PRESETS: RouterPolicyPreset[] = [
  {
    id: 'model-direct',
    name: '默认策略：模型直达',
    description: '请求模型命中逻辑模型列表就直连该模型，否则落到默认逻辑模型（条件 + 两次逻辑模型选择）。',
    isDefault: true,
    createGraph: createDefaultPolicyGraph,
  },
  {
    id: 'protocol-then-condition',
    name: '协议分流模板',
    description: '先识别协议，再按条件分流，最后落到指定逻辑模型。',
    isDefault: false,
    createGraph: createDefaultGraph,
  },
  {
    id: 'iteration-first-enabled',
    name: '遍历迭代模板：首个启用模型',
    description: '遍历 logicalModels，逐项判断是否启用，首次命中即停止并把该模型作为落点。',
    isDefault: false,
    createGraph: createIterationGraph,
  },
]

export function findPolicyPreset(id: string): RouterPolicyPreset | undefined {
  return ROUTER_POLICY_PRESETS.find(preset => preset.id === id)
}

/**
 * 旧数据（或空白数据）里节点坐标会挤在一起，这里按节点类型做一次列式布局。
 * 只有在坐标明显聚集时才生效，避免覆盖用户自己的排版。
 */
export function layoutRouterNodes(nodes: WorkflowNodeModel[]): WorkflowNodeModel[] {
  if (nodes.length <= 1) return nodes

  const positions = nodes.map(node => node.position)
  const minX = Math.min(...positions.map(position => position.x))
  const maxX = Math.max(...positions.map(position => position.x))
  const minY = Math.min(...positions.map(position => position.y))
  const maxY = Math.max(...positions.map(position => position.y))

  const clustered = (maxX - minX) < 180 && (maxY - minY) < 180
  if (!clustered) return nodes

  const nodesByKind = new Map<WorkflowNodeKind, WorkflowNodeModel[]>()
  for (const node of nodes) {
    const list = nodesByKind.get(node.kind) ?? []
    list.push(node)
    nodesByKind.set(node.kind, list)
  }

  const layoutMap = new Map<string, NodePosition>()
  const startX = 80
  const startY = 200
  const columnGap = 340
  const rowGap = 200

  NODE_KIND_ORDER.forEach((kind, column) => {
    const list = nodesByKind.get(kind) ?? []
    list.forEach((node, row) => {
      layoutMap.set(node.id, {
        x: startX + column * columnGap,
        y: startY + row * rowGap,
      })
    })
  })

  return nodes.map(node => ({
    ...node,
    position: layoutMap.get(node.id) ?? node.position,
  }))
}

export function getOperatorsByType(type: SchemaValueType): ConditionOperator[] {
  return DEFAULT_OPERATOR_SET[type]
}

export type WorkflowEdgeData = {
  /** 端口语义，用于自定义连线着色 */
  sourceKind: WorkflowNodeKind
  sourcePort: string
  /** 空闲态连线基础色 */
  stroke: string
  /** 上游 / 下游节点的运行状态，用于渐变与状态着色 */
  sourceRunStatus: NodeRunStatus
  targetRunStatus: NodeRunStatus
  /** 连线任意一端是当前悬浮的节点（对应 Dify 的 `_connectedNodeIsHovering`） */
  highlighted: boolean
  /** 任意一端节点被禁用时整条线降透明度（对应 Dify 的 `_dimmed`） */
  dimmed: boolean
  /** 是否允许在连线上插入节点 */
  canInsert: boolean
  /** 在连线上插入节点（把新节点接到这条连线的中间） */
  onInsert?: (edgeId: string, kind: AppendableKind) => void
}

export type WorkflowFlowEdge = Edge<WorkflowEdgeData>

export type BuildFlowEdgesOptions = {
  onInsert?: (edgeId: string, kind: AppendableKind) => void
  /** 节点运行状态，用于连线渐变 */
  runStatusByNode?: Map<string, NodeRunStatus>
  /** 当前悬浮的节点 id */
  hoveredNodeId?: string | null
}

/**
 * 图数据 → React Flow 边。
 * 端口用显式 id 传递，避免依赖 handle 挂载顺序。
 */
export function buildFlowEdges(graph: WorkflowGraph, options: BuildFlowEdgesOptions = {}): WorkflowFlowEdge[] {
  const kindById = new Map(graph.nodes.map(node => [node.id, node.kind]))
  const enabledById = new Map(graph.nodes.map(node => [node.id, node.enabled]))
  const runStatusByNode = options.runStatusByNode
  const hoveredNodeId = options.hoveredNodeId ?? null

  return graph.edges.map(edge => {
    const sourceKind = kindById.get(edge.sourceNodeId) ?? 'input'
    const stroke = edgeStrokeColor(sourceKind, edge.sourcePort)
    const sourceRunStatus = runStatusByNode?.get(edge.sourceNodeId) ?? 'idle'
    const targetRunStatus = runStatusByNode?.get(edge.targetNodeId) ?? 'idle'
    // 箭头画在终点，所以跟随下游状态色；没有运行过时回落到分支色。
    const markerColor = edgeRunStatusStroke(targetRunStatus) ?? stroke

    return {
      id: edge.id,
      type: 'workflow',
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePort,
      target: edge.targetNodeId,
      targetHandle: 'target',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: markerColor,
      },
      data: {
        sourceKind,
        sourcePort: edge.sourcePort,
        stroke,
        sourceRunStatus,
        targetRunStatus,
        highlighted: hoveredNodeId !== null
          && (edge.sourceNodeId === hoveredNodeId || edge.targetNodeId === hoveredNodeId),
        dimmed: !(enabledById.get(edge.sourceNodeId) ?? true) || !(enabledById.get(edge.targetNodeId) ?? true),
        canInsert: sourceKind !== 'output',
        onInsert: options.onInsert,
      },
    }
  })
}
