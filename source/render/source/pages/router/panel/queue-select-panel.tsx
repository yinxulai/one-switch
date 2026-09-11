import { useCallback, useMemo } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NodePanelProps } from '../node-data'
import type { QueueSelectMode, RuntimeLogicalModel } from '../types'
import {
  NodePanelField,
  NodePanelGroupHeader,
  NodePanelHint,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

type QueueField = 'queueIds' | 'fallbackQueueIds'

interface ModeOption {
  value: QueueSelectMode
  label: string
  description: string
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: 'follow-request-model',
    label: '跟随请求模型（默认策略）',
    description: '请求里的 model 命中某个可用逻辑队列 id 时直连该队列，否则落到兜底队列。',
  },
  {
    value: 'fixed',
    label: '固定队列',
    description: '不关心请求内容，始终使用下方勾选的队列列表。',
  },
]

export function QueueSelectPanel(props: NodePanelProps) {
  const { model, logicalModels, update } = props
  const node = model.kind === 'queue-select' ? model : undefined
  const mode = node?.mode ?? 'fixed'
  const queueIds = node?.queueIds ?? []
  const fallbackQueueIds = node?.fallbackQueueIds ?? []

  const activeDescription = useMemo(
    () => MODE_OPTIONS.find(option => option.value === mode)?.description ?? '',
    [mode],
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
      <NodePanelField label="取值方式">
        <Select
          value={mode}
          onValueChange={value => update(current => current.kind === 'queue-select'
            ? { ...current, mode: value as QueueSelectMode }
            : current)}
        >
          <SelectTrigger className="w-full"><SelectValue placeholder="mode" /></SelectTrigger>
          <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
            {MODE_OPTIONS.map(option => (
              <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </NodePanelField>

      <NodePanelHint>{activeDescription}</NodePanelHint>

      {mode === 'fixed' && (
        <QueuePicker
          emptyHint="暂无可用逻辑队列，请先在队列控制中创建。"
          logicalModels={logicalModels}
          onToggle={toggleQueue}
          selectedIds={queueIds}
          target="queueIds"
          title="目标队列"
        />
      )}

      {mode === 'follow-request-model' && (
        <QueuePicker
          emptyHint="没有选中兜底队列时，回落到内置默认队列 default。"
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
