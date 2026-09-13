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
import type { AppendableKind, IterationCollectMode, WorkflowNodeKind, WorkflowNodeModel } from '@common/router/types'
import type { AppTranslator } from '@/i18n/provider'
import type { UiCatalogKey } from '@common/i18n/catalogs'

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

/** 画布默认列顺序：用于旧数据的自动布局。 */
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
  /** 节点类型名称目录键 */
  labelKey: UiCatalogKey
  /** 一句话说明的目录键，用于选择器与节点面板 */
  hintKey: UiCatalogKey
  icon: NodeKindIcon
  /** 图标色块底色（对齐上游 `block-icon.tsx` 的 util-colors-*-500 纯色块，前景固定白色） */
  tone: string
}

export const NODE_KIND_META: Record<WorkflowNodeKind, NodeKindMeta> = {
  input: {
    labelKey: 'router.node.input.label',
    hintKey: 'router.node.input.hint',
    icon: CirclePlay,
    tone: 'bg-util-colors-blue-brand-blue-brand-500',
  },
  'control-input': {
    labelKey: 'router.node.control-input.label',
    hintKey: 'router.node.control-input.hint',
    icon: ArrowRightLeft,
    tone: 'bg-util-colors-blue-blue-500',
  },
  'protocol-discovery': {
    labelKey: 'router.node.protocol-discovery.label',
    hintKey: 'router.node.protocol-discovery.hint',
    icon: GitBranch,
    tone: 'bg-util-colors-green-green-500',
  },
  condition: {
    labelKey: 'router.node.condition.label',
    hintKey: 'router.node.condition.hint',
    icon: Waypoints,
    tone: 'bg-util-colors-cyan-cyan-500',
  },
  'model-select': {
    labelKey: 'router.node.model-select.label',
    hintKey: 'router.node.model-select.hint',
    icon: ArrowRightLeft,
    tone: 'bg-util-colors-indigo-indigo-500',
  },
  iteration: {
    labelKey: 'router.node.iteration.label',
    hintKey: 'router.node.iteration.hint',
    icon: Repeat2,
    tone: 'bg-util-colors-violet-violet-500',
  },
  script: {
    labelKey: 'router.node.script.label',
    hintKey: 'router.node.script.hint',
    icon: SquareCode,
    tone: 'bg-util-colors-yellow-yellow-500',
  },
  prompt: {
    labelKey: 'router.node.prompt.label',
    hintKey: 'router.node.prompt.hint',
    icon: Sparkles,
    tone: 'bg-util-colors-pink-pink-500',
  },
  output: {
    labelKey: 'router.node.output.label',
    hintKey: 'router.node.output.hint',
    icon: ArrowRight,
    tone: 'bg-util-colors-warning-warning-500',
  },
}

export const FALLBACK_NODE_ICON = Braces

/** 迭代节点的结果收集模式文案键（节点视图、面板、Trace 共用）。 */
export const ITERATION_COLLECT_MODE_LABELS: Record<IterationCollectMode, UiCatalogKey> = {
  first: 'router.iterationMode.first',
  last: 'router.iterationMode.last',
  list: 'router.iterationMode.list',
  count: 'router.iterationMode.count',
}

/** 迭代节点的结果收集模式说明键，用于面板里的候选项补充解释。 */
export const ITERATION_COLLECT_MODE_HINTS: Record<IterationCollectMode, UiCatalogKey> = {
  first: 'router.iterationModeHint.first',
  last: 'router.iterationModeHint.last',
  list: 'router.iterationModeHint.list',
  count: 'router.iterationModeHint.count',
}

export function toCanvasNodeType(kind: WorkflowNodeKind): CanvasNodeType {
  if (kind === 'input') return 'route-input'
  if (kind === 'output') return 'route-output'
  return kind
}

export function kindLabel(t: AppTranslator, kind: WorkflowNodeKind): string {
  const key = NODE_KIND_META[kind]?.labelKey
  return key ? t(key) : t('router.summary.unknownKind')
}

export function kindIcon(kind: WorkflowNodeKind): NodeKindIcon {
  return NODE_KIND_META[kind]?.icon ?? FALLBACK_NODE_ICON
}

export function kindTone(kind: WorkflowNodeKind): string {
  return NODE_KIND_META[kind]?.tone ?? 'bg-primary'
}

export function nodeSummary(t: AppTranslator, model: WorkflowNodeModel): string {
  if (model.kind === 'input') return t(NODE_KIND_META.input.hintKey)
  if (model.kind === 'control-input') return t('router.summary.controls', { count: model.controls.filter(control => control.enabled).length })
  if (model.kind === 'protocol-discovery') return t(NODE_KIND_META['protocol-discovery'].hintKey)
  if (model.kind === 'condition') return t('router.summary.cases', { count: model.cases.length })
  if (model.kind === 'model-select') {
    if (model.source === 'variable') {
      const variablePath = model.variablePath.trim()
      return variablePath ? t('router.summary.variablePath', { path: variablePath }) : t('router.summary.variablePathEmpty')
    }
    return t('router.summary.models', { count: model.modelIds.length })
  }
  if (model.kind === 'iteration') {
    const sourcePath = model.sourcePath.trim()
    if (!sourcePath) return t('router.summary.iterationSourceEmpty')
    return t('router.summary.iterationSource', { path: sourcePath, count: model.maxIterations })
  }
  if (model.kind === 'script') {
    const resultPath = model.resultPath.trim()
    return resultPath ? t('router.summary.resultPath', { path: resultPath }) : t('router.summary.resultPathEmpty')
  }
  if (model.kind === 'prompt') {
    const logicalModelId = model.logicalModelId.trim()
    return logicalModelId ? t('router.summary.logicalModel', { id: logicalModelId }) : t('router.summary.logicalModelEmpty')
  }
  return t(NODE_KIND_META.output.hintKey)
}

export function nodePanelHint(t: AppTranslator, model: WorkflowNodeModel): string {
  if (model.kind === 'input') return t('router.panelHint.input')
  if (model.kind === 'output') return t('router.panelHint.output')
  if (model.kind === 'control-input') return t('router.panelHint.controlInput')
  if (model.kind === 'protocol-discovery') return t('router.panelHint.protocolDiscovery')
  if (model.kind === 'condition') return t('router.panelHint.condition')
  if (model.kind === 'model-select') return t('router.panelHint.modelSelect')
  if (model.kind === 'iteration') return t('router.panelHint.iteration')
  if (model.kind === 'script') return t('router.panelHint.script')
  if (model.kind === 'prompt') return t('router.panelHint.prompt')
  return t('router.panelHint.fallback')
}

/** 输入 / 输出节点为固定节点：名称与描述不可修改，也不可删除。 */
export function isProtectedNode(model: WorkflowNodeModel): boolean {
  return model.kind === 'input' || model.kind === 'output'
}

/**
 * 连线在“无状态、无交互”时的颜色。
 * 对应上游的 `--color-workflow-link-line-normal`。
 * 上游只有一种灰，本仓库额外按分支区分颜色，属于 One Switch 的信息增强，
 * 分支色取自 util-colors 色板，保证明暗两套主题下都与节点图标同色系。
 */
export const EDGE_STROKE_NORMAL = 'var(--color-workflow-link-line-normal)'

/**
 * 连线被选中 / 悬浮 / 连接节点被悬浮时的颜色。
 * 对应上游的 `--color-workflow-link-line-handle`。
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
 * 运行状态对应的连线颜色，对应上游 `app/components/workflow/utils/edge.ts` 的 `getEdgeColor`。
 * 未运行过（`idle`）时返回 undefined，交给调用方回落到分支色。
 */
export function edgeRunStatusStroke(status: NodeRunStatus | undefined): string | undefined {
  if (status === 'succeeded') return 'var(--color-workflow-link-line-success-handle)'
  if (status === 'failed') return 'var(--color-workflow-link-line-error-handle)'
  if (status === 'running') return 'var(--color-workflow-link-line-handle)'
  return undefined
}
