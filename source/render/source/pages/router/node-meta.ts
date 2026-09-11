import type { ComponentType } from 'react'
import {
  ArrowRight,
  ArrowRightLeft,
  Braces,
  CirclePlay,
  GitBranch,
  Repeat2,
  Sparkles,
  SquareCode,
  Waypoints,
} from 'lucide-react'

import type { NodeRunStatus } from './node-data'
import type { IterationCollectMode, WorkflowNodeKind, WorkflowNodeModel } from './types'

/**
 * 可以新增到画布上的节点类型。
 * 输入 / 输出节点是固定节点，不允许新增，也不允许删除。
 */
export type AppendableKind = Extract<
  WorkflowNodeKind,
  'control-input' | 'protocol-discovery' | 'condition' | 'model-select' | 'iteration' | 'script' | 'prompt'
>

/** React Flow 中注册的节点类型名。 */
export type CanvasNodeType =
  | 'route-input'
  | 'control-input'
  | 'route-output'
  | 'protocol-discovery'
  | 'condition'
  | 'model-select'
  | 'iteration'
  | 'script'
  | 'prompt'

export const APPENDABLE_KINDS: AppendableKind[] = [
  'control-input',
  'protocol-discovery',
  'condition',
  'model-select',
  'iteration',
  'script',
  'prompt',
]

/** 画布默认列顺序：既用于图例排序，也用于旧数据的自动布局。 */
export const NODE_KIND_ORDER: WorkflowNodeKind[] = [
  'input',
  'control-input',
  'protocol-discovery',
  'condition',
  'iteration',
  'script',
  'prompt',
  'model-select',
  'output',
]

export type NodeKindIcon = ComponentType<{ className?: string }>

export interface NodeKindMeta {
  /** 节点类型名称 */
  label: string
  /** 一句话说明，用于选择器与节点面板 */
  hint: string
  icon: NodeKindIcon
  /** 图标色块底色（对齐 Dify `block-icon.tsx` 的 util-colors-*-500 纯色块，前景固定白色） */
  tone: string
  /** 端口、连线、图例使用的强调色 */
  accent: string
}

export const NODE_KIND_META: Record<WorkflowNodeKind, NodeKindMeta> = {
  input: {
    label: '输入请求',
    hint: '接收原始请求并开始路由',
    icon: CirclePlay,
    tone: 'bg-util-colors-blue-brand-blue-brand-500',
    accent: 'bg-util-colors-blue-brand-blue-brand-500',
  },
  'control-input': {
    label: '控制输入',
    hint: '注入开关或下拉控制值',
    icon: ArrowRightLeft,
    tone: 'bg-util-colors-blue-blue-500',
    accent: 'bg-util-colors-blue-blue-500',
  },
  'protocol-discovery': {
    label: '协议发现',
    hint: '识别协议并输出分支',
    icon: GitBranch,
    tone: 'bg-util-colors-green-green-500',
    accent: 'bg-util-colors-green-green-500',
  },
  condition: {
    label: '条件',
    hint: 'IF / ELSE 多分支',
    icon: Waypoints,
    tone: 'bg-util-colors-cyan-cyan-500',
    accent: 'bg-util-colors-cyan-cyan-500',
  },
  'model-select': {
    label: '逻辑模型选择',
    hint: '决定请求落到哪个逻辑模型',
    icon: ArrowRightLeft,
    tone: 'bg-util-colors-indigo-indigo-500',
    accent: 'bg-util-colors-indigo-indigo-500',
  },
  iteration: {
    label: '遍历迭代',
    hint: '遍历数组 / 对象，逐项跑循环体',
    icon: Repeat2,
    tone: 'bg-util-colors-violet-violet-500',
    accent: 'bg-util-colors-violet-violet-500',
  },
  script: {
    label: 'JS 脚本',
    hint: '沙箱里跑一段 JS，把结果写回 payload',
    icon: SquareCode,
    tone: 'bg-util-colors-yellow-yellow-500',
    accent: 'bg-util-colors-yellow-yellow-500',
  },
  prompt: {
    label: 'LLM 节点',
    hint: '用指定逻辑模型执行提示词',
    icon: Sparkles,
    tone: 'bg-util-colors-pink-pink-500',
    accent: 'bg-util-colors-pink-pink-500',
  },
  output: {
    label: '路由结果出口',
    hint: '输出可用逻辑模型，交由代理执行',
    icon: ArrowRight,
    tone: 'bg-util-colors-warning-warning-500',
    accent: 'bg-util-colors-warning-warning-500',
  },
}

export const FALLBACK_NODE_ICON = Braces

/** 迭代节点的结果收集模式文案（节点视图、面板、Trace 共用）。 */
export const ITERATION_COLLECT_MODE_LABELS: Record<IterationCollectMode, string> = {
  first: '取首个命中',
  last: '取最后一个命中',
  list: '汇总为列表',
  count: '只统计轮数',
}

/** 迭代节点的结果收集模式说明，用于面板里的候选项补充解释。 */
export const ITERATION_COLLECT_MODE_HINTS: Record<IterationCollectMode, string> = {
  first: '命中即停止遍历，结果写命中的那一个值',
  last: '遍历到底，结果写最后一个命中的值',
  list: '遍历到底，结果写所有命中值组成的数组',
  count: '不收集值，结果写实际执行的轮数',
}

export function toCanvasNodeType(kind: WorkflowNodeKind): CanvasNodeType {
  if (kind === 'input') return 'route-input'
  if (kind === 'output') return 'route-output'
  return kind
}

export function kindLabel(kind: WorkflowNodeKind): string {
  return NODE_KIND_META[kind]?.label ?? '节点'
}

export function kindIcon(kind: WorkflowNodeKind): NodeKindIcon {
  return NODE_KIND_META[kind]?.icon ?? FALLBACK_NODE_ICON
}

export function kindTone(kind: WorkflowNodeKind): string {
  return NODE_KIND_META[kind]?.tone ?? 'bg-primary'
}

export function kindAccent(kind: WorkflowNodeKind): string {
  return NODE_KIND_META[kind]?.accent ?? 'bg-primary'
}

export function nodeSummary(model: WorkflowNodeModel): string {
  if (model.kind === 'input') return NODE_KIND_META.input.hint
  if (model.kind === 'control-input') return `${model.controls.filter(control => control.enabled).length} 个控制项`
  if (model.kind === 'protocol-discovery') return NODE_KIND_META['protocol-discovery'].hint
  if (model.kind === 'condition') return `${model.cases.length} 个分支 + ELSE`
  if (model.kind === 'model-select') {
    if (model.source === 'variable') {
      const variablePath = model.variablePath.trim()
      return variablePath ? `取值字段 ${variablePath}` : '未选择取值字段'
    }
    return `${model.modelIds.length} 个逻辑模型`
  }
  if (model.kind === 'iteration') {
    const sourcePath = model.sourcePath.trim()
    if (!sourcePath) return '未配置遍历来源'
    return `遍历 ${sourcePath} · 上限 ${model.maxIterations} 轮`
  }
  if (model.kind === 'script') {
    const resultPath = model.resultPath.trim()
    return resultPath ? `结果写入 ${resultPath}` : '未配置结果写回路径'
  }
  if (model.kind === 'prompt') {
    const logicalModelId = model.logicalModelId.trim()
    return logicalModelId ? `逻辑模型 ${logicalModelId}` : '未选择逻辑模型'
  }
  return NODE_KIND_META.output.hint
}

export function nodePanelHint(model: WorkflowNodeModel): string {
  if (model.kind === 'input') return '输入节点无配置项，仅作为路由入口。'
  if (model.kind === 'output') return '输出节点无核心配置项，固定作为路由出口。Trace 与摘要仅影响调试可见性。'
  if (model.kind === 'control-input') return '控制输入节点会把开关、下拉等值写入 route.controls，供条件节点和其他逻辑引用。'
  if (model.kind === 'protocol-discovery') return '该节点无配置项，系统会自动分析请求并输出 openai-completions/openai-responses/anthropic-messages/unknown 分支。'
  if (model.kind === 'condition') return '字段来源于上游 schema，每个分支可包含多个条件，按 AND / OR 组合判定；首个命中的分支生效，否则走 ELSE。'
  if (model.kind === 'model-select') return '取值来源决定落点：固定选择直接用勾选的逻辑模型；变量取值则把指定字段当作逻辑模型 id（字符串或字符串数组），取不到时用兜底逻辑模型。'
  if (model.kind === 'iteration') return '遍历来源支持通配投影（如 logicalModels[*].id）；数组按元素、对象按键值对遍历，每轮把当前项写入 route.iteration 后从 body 端口进入循环体，循环体末端连回本节点即视为本轮结束。'
  if (model.kind === 'script') return '脚本在服务端沙箱里执行：可用 payload（payload 深拷贝）、get(路径)（支持 a[*].b 通配投影）与 console，用 return 交回结果并写入结果路径。没有 require / import / 网络 / 文件系统，超时会被中断。'
  if (model.kind === 'prompt') return 'LLM 节点用指定逻辑模型执行提示词，走的是和真实请求同一条上游通路（含密钥、协议转换与故障转移）。提示词模板支持 ${路径} 取值，回复写入结果路径供下游条件判断。'
  return '该节点不会直接返回模型响应，而是返回一个可用逻辑模型交由代理执行。'
}

/** 输入 / 输出节点为固定节点：名称与描述不可修改，也不可删除。 */
export function isProtectedNode(model: WorkflowNodeModel): boolean {
  return model.kind === 'input' || model.kind === 'output'
}

/**
 * 连线在“无状态、无交互”时的颜色。
 * 对应 Dify 的 `--color-workflow-link-line-normal`。
 * Dify 只有一种灰，这里保留按上游分支区分颜色，属于 One Switch 的信息增强，
 * 分支色取自 Dify 的 util-colors 色板，保证明暗两套主题下都与节点图标同色系。
 */
export const EDGE_STROKE_NORMAL = 'var(--color-workflow-link-line-normal)'

/**
 * 连线被选中 / 悬浮 / 连接节点被悬浮时的颜色。
 * 对应 Dify 的 `--color-workflow-link-line-handle`。
 */
export const EDGE_STROKE_HANDLE = 'var(--color-workflow-link-line-handle)'

const cyanStroke = 'var(--color-util-colors-cyan-cyan-500)'
const violetStroke = 'var(--color-util-colors-indigo-indigo-500)'
const emeraldStroke = 'var(--color-util-colors-blue-blue-500)'
const iterationStroke = 'var(--color-util-colors-violet-violet-500)'
const scriptStroke = 'var(--color-util-colors-yellow-yellow-500)'
const promptStroke = 'var(--color-util-colors-pink-pink-500)'

/** 连线颜色：按上游节点的类型与端口区分分支语义。 */
export function edgeStrokeColor(sourceKind: WorkflowNodeKind, sourcePort: string): string {
  if (sourceKind === 'protocol-discovery') {
    return sourcePort === 'unknown' ? 'var(--color-text-warning)' : cyanStroke
  }
  if (sourceKind === 'condition') {
    return sourcePort === 'else' ? EDGE_STROKE_NORMAL : 'var(--color-util-colors-green-green-500)'
  }
  if (sourceKind === 'model-select') return violetStroke
  if (sourceKind === 'control-input') return emeraldStroke
  if (sourceKind === 'iteration') return sourcePort === 'body' ? iterationStroke : EDGE_STROKE_NORMAL
  if (sourceKind === 'script') return scriptStroke
  if (sourceKind === 'prompt') return promptStroke
  return EDGE_STROKE_NORMAL
}

/**
 * 运行状态对应的连线颜色，对应 Dify `app/components/workflow/utils/edge.ts` 的 `getEdgeColor`。
 * 未运行过（`idle`）时返回 undefined，交给调用方回落到分支色。
 */
export function edgeRunStatusStroke(status: NodeRunStatus | undefined): string | undefined {
  if (status === 'succeeded') return 'var(--color-workflow-link-line-success-handle)'
  if (status === 'failed') return 'var(--color-workflow-link-line-error-handle)'
  if (status === 'running') return 'var(--color-workflow-link-line-handle)'
  return undefined
}
