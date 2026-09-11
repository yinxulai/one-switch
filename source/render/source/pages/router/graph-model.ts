import { MarkerType, type Edge } from '@xyflow/react'

import {
  NODE_KIND_ORDER,
  edgeRunStatusStroke,
  edgeStrokeColor,
  type AppendableKind,
} from './node-meta'
import type { NodeRunStatus } from './node-data'
import {
  DEFAULT_OPERATOR_SET,
  DEFAULT_QUEUE_IDS,
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

export const samplePayload = {
  request: {
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'x-provider': ['openai'],
      userAgent: 'OneSwitch/1.0',
    },
    body: {
      model: 'gpt-4o-mini',
      tenant: 'vip-cn',
      priority: 2,
      messages: [{ role: 'user', content: 'Summarize this article in Chinese.' }],
    },
  },
  metadata: { source: 'desktop-app' },
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
}

export function createConditionRule(): ConditionRule {
  return {
    fieldPath: 'request.body.tenant',
    valueType: 'string',
    operator: 'startsWith',
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

  return {
    id,
    kind: 'queue-select',
    name: '队列选择节点',
    enabled: true,
    description: '选择一个或多个逻辑队列，交由出口执行。',
    position,
    source: 'fixed',
    variablePath: '',
    queueIds: [],
    fallbackQueueIds: [],
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
 * 默认策略：请求模型命中逻辑队列 id 就直连该队列，否则落到默认队列。
 *
 * 规则全部由基础节点组合而成，没有任何专用节点：
 * 输入 → 条件（route.requestedModelInQueues）→ 队列选择（变量取值）→ 出口
 *                                          └→ 队列选择（固定 default）→ 出口
 */
export function createDefaultPolicyGraph(): WorkflowGraph {
  const conditionCase: ConditionCase = {
    ...createConditionCase('case-1'),
    name: '请求模型是逻辑队列',
    conditions: [
      {
        fieldPath: 'route.requestedModelInQueues',
        valueType: 'boolean',
        operator: 'isTrue',
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
        name: '请求模型是否命中逻辑队列',
        enabled: true,
        description: 'route.requestedModelInQueues 为真时走直连分支，否则落到默认队列。',
        position: { x: 460, y: 220 },
        cases: [conditionCase],
      },
      {
        id: 'queue-direct',
        kind: 'queue-select',
        name: '直连请求模型队列',
        enabled: true,
        description: '把 route.requestedModel 的取值直接当作队列 id。',
        position: { x: 860, y: 110 },
        source: 'variable',
        variablePath: 'route.requestedModel',
        queueIds: [],
        fallbackQueueIds: [],
      },
      {
        id: 'queue-default',
        kind: 'queue-select',
        name: '默认队列',
        enabled: true,
        description: '未命中逻辑队列时落到内置默认队列。',
        position: { x: 860, y: 330 },
        source: 'fixed',
        variablePath: '',
        queueIds: [...DEFAULT_QUEUE_IDS],
        fallbackQueueIds: [],
      },
      createOutputNode({ x: 1260, y: 220 }),
    ],
    edges: [
      { id: 'edge-input-condition', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'condition' },
      { id: 'edge-condition-direct', sourceNodeId: 'condition', sourcePort: conditionCase.id, targetNodeId: 'queue-direct' },
      { id: 'edge-condition-else', sourceNodeId: 'condition', sourcePort: 'else', targetNodeId: 'queue-default' },
      { id: 'edge-queue-direct-output', sourceNodeId: 'queue-direct', sourcePort: 'out', targetNodeId: 'output' },
      { id: 'edge-queue-default-output', sourceNodeId: 'queue-default', sourcePort: 'out', targetNodeId: 'output' },
    ],
  }
}

/** 协议分流模板：先识别协议，再按条件分流，最后落到不同队列。 */
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
      id: 'queue',
      kind: 'queue-select',
      name: '队列选择',
      enabled: true,
      description: '选择一个或多个逻辑队列，交由出口执行。',
      position: { x: 1100, y: 220 },
      source: 'fixed',
      variablePath: '',
      queueIds: [],
      fallbackQueueIds: [],
    },
    createOutputNode({ x: 1440, y: 220 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-protocol', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' },
    { id: 'edge-protocol-completions', sourceNodeId: 'protocol', sourcePort: 'openai-completions', targetNodeId: 'condition' },
    { id: 'edge-protocol-responses', sourceNodeId: 'protocol', sourcePort: 'openai-responses', targetNodeId: 'condition' },
    { id: 'edge-protocol-anthropic', sourceNodeId: 'protocol', sourcePort: 'anthropic-messages', targetNodeId: 'condition' },
    { id: 'edge-protocol-unknown', sourceNodeId: 'protocol', sourcePort: 'unknown', targetNodeId: 'queue' },
    { id: 'edge-condition-case', sourceNodeId: 'condition', sourcePort: conditionCase.id, targetNodeId: 'queue' },
    { id: 'edge-condition-else', sourceNodeId: 'condition', sourcePort: 'else', targetNodeId: 'queue' },
    { id: 'edge-queue-output', sourceNodeId: 'queue', sourcePort: 'out', targetNodeId: 'output' },
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

/** 策略预设：一键把画布换成某种内置规则，随时可切回默认策略。 */
export const ROUTER_POLICY_PRESETS: RouterPolicyPreset[] = [
  {
    id: 'model-direct',
    name: '默认策略：模型直达',
    description: '请求模型命中逻辑队列就直连该队列，否则落到默认队列（由条件 + 队列选择基础节点组合而成）。',
    isDefault: true,
    createGraph: createDefaultPolicyGraph,
  },
  {
    id: 'protocol-then-condition',
    name: '协议分流模板',
    description: '先识别协议，再按条件分流，最后落到指定队列。',
    isDefault: false,
    createGraph: createDefaultGraph,
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
