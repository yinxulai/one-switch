import { useCallback, useMemo } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NodePanelProps } from '../node-data'
import type { ModelSelectSource, RuntimeLogicalModel } from '../types'
import {
  NodePanelField,
  NodePanelGroupHeader,
  NodePanelHint,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

type ModelField = 'modelIds' | 'fallbackModelIds'

interface SourceOption {
  value: ModelSelectSource
  label: string
  description: string
}

const SOURCE_OPTIONS: SourceOption[] = [
  {
    value: 'fixed',
    label: '固定选择',
    description: '不关心请求内容，始终使用下方勾选的逻辑模型列表。',
  },
  {
    value: 'variable',
    label: '变量取值',
    description: '把上游字段的取值直接当作逻辑模型 id（字符串或字符串数组），取不到时回落到兜底列表。',
  },
]

export function ModelSelectPanel(props: NodePanelProps) {
  const { model, nodeModels, logicalModels, conditionFieldHints, update } = props
  const node = model.kind === 'model-select' ? model : undefined
  const source = node?.source ?? 'fixed'
  const variablePath = node?.variablePath ?? ''
  const modelIds = node?.modelIds ?? []
  const fallbackModelIds = node?.fallbackModelIds ?? []

  const activeDescription = useMemo(
    () => SOURCE_OPTIONS.find(option => option.value === source)?.description ?? '',
    [source],
  )

  /** 变量取值只能来自字符串 / 字符串数组字段：逻辑模型 id 的形态。 */
  const variableFields = useMemo(
    () => conditionFieldHints.filter(field => field.valueType === 'string' || field.valueType === 'array'),
    [conditionFieldHints],
  )

  const sourceNameOf = useMemo(
    () => new Map(nodeModels.map(item => [item.id, item.name])),
    [nodeModels],
  )

  const toggleModel = useCallback((field: ModelField, modelId: string, checked: boolean) => {
    update(current => {
      if (current.kind !== 'model-select') return current
      const selected = current[field]
      return {
        ...current,
        [field]: checked
          ? [...new Set([...selected, modelId])]
          : selected.filter(id => id !== modelId),
      }
    })
  }, [update])

  if (!node) return null

  return (
    <div className="grid gap-2.5">
      <NodePanelField label="取值来源">
        <Select
          value={source}
          onValueChange={value => update(current => current.kind === 'model-select'
            ? { ...current, source: value as ModelSelectSource }
            : current)}
        >
          <SelectTrigger className="w-full"><SelectValue placeholder="source" /></SelectTrigger>
          <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
            {SOURCE_OPTIONS.map(option => (
              <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </NodePanelField>

      <NodePanelHint>{activeDescription}</NodePanelHint>

      {source === 'variable' && (
        <NodePanelField label="取值字段（上游 schema）">
          <Select
            value={variablePath || undefined}
            onValueChange={value => update(current => current.kind === 'model-select'
              ? { ...current, variablePath: value }
              : current)}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="field path" /></SelectTrigger>
            <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
              {variableFields.map(field => (
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                  {/* 名称前置：先看「来自哪个节点」，再看具体字段路径与类型。 */}
                  {sourceNameOf.get(field.sourceNodeId) ?? field.sourceNodeId} · {field.path} · {field.valueType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </NodePanelField>
      )}

      {source === 'variable' && variableFields.length === 0 && (
        <NodePanelHint tone="warning">
          暂无可用字段，请先把会产生字符串字段的节点连接到当前节点上游。
        </NodePanelHint>
      )}

      {source === 'fixed'
        ? (
          <ModelPicker
            emptyHint="暂无可用逻辑模型，请先在逻辑模型页面创建。"
            logicalModels={logicalModels}
            onToggle={toggleModel}
            selectedIds={modelIds}
            target="modelIds"
            title="目标逻辑模型"
          />
        )
        : (
          <ModelPicker
            emptyHint="没有勾选兜底逻辑模型时，取不到值就不产出落点。"
            logicalModels={logicalModels}
            onToggle={toggleModel}
            selectedIds={fallbackModelIds}
            target="fallbackModelIds"
            title="兜底逻辑模型"
          />
        )}
    </div>
  )
}

interface ModelPickerProps {
  title: string
  emptyHint: string
  logicalModels: RuntimeLogicalModel[]
  selectedIds: string[]
  target: ModelField
  onToggle: (target: ModelField, modelId: string, checked: boolean) => void
}

function ModelPicker(props: ModelPickerProps) {
  const { title, emptyHint, logicalModels, selectedIds, target, onToggle } = props

  return (
    <div className="grid gap-2">
      <NodePanelGroupHeader title={title} />
      {logicalModels.length === 0 && <NodePanelHint tone="warning">{emptyHint}</NodePanelHint>}
      <div className="grid gap-1.5">
        {logicalModels.map(logicalModel => (
          <label key={logicalModel.id} className="flex items-center gap-2 rounded-lg bg-workflow-block-parma-bg px-2.5 py-2 system-xs-regular text-text-secondary">
            <input
              type="checkbox"
              checked={selectedIds.includes(logicalModel.id)}
              onChange={event => onToggle(target, logicalModel.id, event.target.checked)}
            />
            <span className="min-w-0 flex-1 truncate">{logicalModel.name}</span>
            <span className="shrink-0 font-mono system-2xs-regular text-text-tertiary">{logicalModel.id}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
