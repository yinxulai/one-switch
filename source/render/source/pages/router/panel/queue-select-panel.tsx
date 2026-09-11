import { useCallback, useMemo } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NodePanelProps } from '../node-data'
import type { QueueSelectSource, RuntimeLogicalModel } from '../types'
import {
  NodePanelField,
  NodePanelGroupHeader,
  NodePanelHint,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

type QueueField = 'queueIds' | 'fallbackQueueIds'

interface SourceOption {
  value: QueueSelectSource
  label: string
  description: string
}

const SOURCE_OPTIONS: SourceOption[] = [
  {
    value: 'fixed',
    label: '固定队列',
    description: '不关心请求内容，始终使用下方勾选的队列列表。',
  },
  {
    value: 'variable',
    label: '变量取值',
    description: '把上游字段的取值直接当作队列 id（字符串或字符串数组），取不到时回落到兜底队列。',
  },
]

export function QueueSelectPanel(props: NodePanelProps) {
  const { model, nodeModels, logicalModels, conditionFieldHints, update } = props
  const node = model.kind === 'queue-select' ? model : undefined
  const source = node?.source ?? 'fixed'
  const variablePath = node?.variablePath ?? ''
  const queueIds = node?.queueIds ?? []
  const fallbackQueueIds = node?.fallbackQueueIds ?? []

  const activeDescription = useMemo(
    () => SOURCE_OPTIONS.find(option => option.value === source)?.description ?? '',
    [source],
  )

  /** 变量取值只能来自字符串 / 字符串数组字段：队列 id 的形态。 */
  const variableFields = useMemo(
    () => conditionFieldHints.filter(field => field.valueType === 'string' || field.valueType === 'array'),
    [conditionFieldHints],
  )

  const sourceNameOf = useMemo(
    () => new Map(nodeModels.map(item => [item.id, item.name])),
    [nodeModels],
  )

  const toggleQueue = useCallback((field: QueueField, queueId: string, checked: boolean) => {
    update(current => {
      if (current.kind !== 'queue-select') return current
      const selected = current[field]
      return {
        ...current,
        [field]: checked
          ? [...new Set([...selected, queueId])]
          : selected.filter(id => id !== queueId),
      }
    })
  }, [update])

  if (!node) return null

  return (
    <div className="grid gap-2.5">
      <NodePanelField label="取值来源">
        <Select
          value={source}
          onValueChange={value => update(current => current.kind === 'queue-select'
            ? { ...current, source: value as QueueSelectSource }
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
            onValueChange={value => update(current => current.kind === 'queue-select'
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
          <QueuePicker
            emptyHint="暂无可用逻辑队列，请先在队列控制中创建。"
            logicalModels={logicalModels}
            onToggle={toggleQueue}
            selectedIds={queueIds}
            target="queueIds"
            title="目标队列"
          />
        )
        : (
          <QueuePicker
            emptyHint="没有勾选兜底队列时，取不到值就不产出落点。"
            logicalModels={logicalModels}
            onToggle={toggleQueue}
            selectedIds={fallbackQueueIds}
            target="fallbackQueueIds"
            title="兜底队列"
          />
        )}
    </div>
  )
}

interface QueuePickerProps {
  title: string
  emptyHint: string
  logicalModels: RuntimeLogicalModel[]
  selectedIds: string[]
  target: QueueField
  onToggle: (target: QueueField, queueId: string, checked: boolean) => void
}

function QueuePicker(props: QueuePickerProps) {
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
