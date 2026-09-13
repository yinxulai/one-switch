import type { Node, NodeProps } from '@xyflow/react'

import type { AppendableKind, RuntimeLogicalModel, SchemaFieldDescriptor, WorkflowNodeModel } from '@common/router/types'
import type { CanvasNodeType } from './node-meta'

/** 单次测试运行后，节点在画布上的状态标记。 */
export type NodeRunStatus = 'idle' | 'running' | 'succeeded' | 'failed'

/**
 * 画布上的插入请求。
 * - `prevNodeId`：从某个节点的输出端口往下插入
 * - `edgeId`：在一条已有连线上插入
 */
export type NodeInsertRequest =
  | {
    kind: AppendableKind
    prevNodeId: string
    prevSourcePort: string
  }
  | {
    kind: AppendableKind
    edgeId: string
  }

/**
 * 所有画布节点共享的数据契约。
 * 注意：节点组件通过 props 拿到它，不额外引入 context，方便单独渲染与测试。
 */
export interface RouteNodeData extends Record<string, unknown> {
  model: WorkflowNodeModel
  /** 是否被选中（选中时展示操作条与增强样式） */
  isSelected: boolean
  /** 最近一次测试运行的状态 */
  runStatus: NodeRunStatus
  /** 已经连出连线的 source 端口 */
  connectedSourcePorts: string[]
  /** 是否有连线接入（用于 target 端口提示） */
  targetConnected: boolean
  /** 是否允许通过端口插入节点 */
  canInsert: boolean
  onOpen: (nodeId: string) => void
  onUpdateNode: (nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => void
  onRequestInsert: (request: NodeInsertRequest) => void
  onDeleteNode: (nodeId: string) => void
  onDuplicateNode: (nodeId: string) => void
}

/** 注册到 React Flow 的节点类型。 */
export type RouteFlowNode = Node<RouteNodeData, CanvasNodeType>

/** 所有节点视图组件共享的 props。 */
export type RouteNodeProps = NodeProps<RouteFlowNode>

/** 节点面板里统一使用的局部更新函数。 */
export type NodePanelUpdate = (updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => void

/**
 * 节点面板里展示的逻辑模型。
 *
 * 比运行时形状多一个 `description`：说明只在配置界面里给人看，
 * 图与引擎都不读它（引擎归一化模型列表时只留 id / 名称 / 开关）。
 */
export interface PanelLogicalModel extends RuntimeLogicalModel {
  description?: string
}

/**
 * 右侧节点面板的 props。
 * 组件按节点种类注册，内部自行收窄 `model` 类型。
 */
export interface NodePanelProps {
  model: WorkflowNodeModel
  update: NodePanelUpdate
  /** 当前图上的全部节点，用于展示字段 / 逻辑模型来源 */
  nodeModels: WorkflowNodeModel[]
  /** 可选逻辑模型 */
  logicalModels: PanelLogicalModel[]
  /** 上游 schema 推出的可用字段（条件节点与逻辑模型选择节点的变量取值共用） */
  conditionFieldHints: SchemaFieldDescriptor[]
}
