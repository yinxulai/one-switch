import type { NodePanelProps } from '../node-data'
import type { QueueSelectNode } from '../types'
import { NodePanelHint } from './panel-fields'

export function QueueSelectPanel(props: NodePanelProps) {
  const { model, logicalModels, update } = props
  const node = model as QueueSelectNode

  return (
    <div className="grid gap-2.5">
      <NodePanelHint>队列选择节点只负责输出一个或多个逻辑队列，不内置任何路由策略。</NodePanelHint>

      <div className="grid gap-1.5">
        {logicalModels.map(logicalModel => (
          <label key={logicalModel.id} className="flex items-center gap-2 rounded-lg bg-muted/35 px-2.5 py-2 text-xs">
            <input
              type="checkbox"
              checked={node.queueIds.includes(logicalModel.id)}
              onChange={event => update(current => current.kind === 'queue-select'
                ? {
                  ...current,
                  queueIds: event.target.checked
                    ? [...new Set([...current.queueIds, logicalModel.id])]
                    : current.queueIds.filter(id => id !== logicalModel.id),
                }
                : current)}
            />
            <span className="min-w-0 flex-1 truncate">{logicalModel.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{logicalModel.id}</span>
          </label>
        ))}
      </div>

      {logicalModels.length === 0 && (
        <NodePanelHint tone="warning">暂无可用逻辑队列，请先在队列控制中创建。</NodePanelHint>
      )}
    </div>
  )
}
