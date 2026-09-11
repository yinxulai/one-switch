import { memo } from 'react'

import { cn } from '@/lib/utils'
import { NODE_COMPONENT_MAP } from '../nodes'
import { isProtectedNode } from '../node-meta'
import type { NodeRunStatus, RouteNodeProps } from '../node-data'
import { BlockIcon } from './block-icon'
import { NodeActionBar } from './node-action-bar'
import { NodeHandle } from './node-handle'
import { NodeDescription, NodeHeaderMeta } from './node-sections'

/** 运行状态边框，对应 Dify 的 border-state-*-solid!。 */
const runStatusBorderClassName: Partial<Record<NodeRunStatus, string>> = {
  running: 'border-info!',
  succeeded: 'border-success!',
  failed: 'border-destructive!',
}

/**
 * 节点外壳，结构与类名逐行对齐 Dify `app/components/workflow/nodes/_base/node.tsx`：
 * 外层容器负责选中/状态边框，内层提供标题行、节点主体、描述与端口。
 * 按仓库偏好去掉了 Dify 的 shadow-xs / hover:shadow-lg，层次改由 bg-card 的明度差承担。
 */
export const WorkflowNode = memo(function WorkflowNode(props: RouteNodeProps) {
  const { id, data, selected } = props
  const model = data.model
  const Body = NODE_COMPONENT_MAP[model.kind]
  const isSelected = Boolean(selected) || data.isSelected
  const protectedNode = isProtectedNode(model)
  const canDelete = !protectedNode
  const statusBorder = runStatusBorderClassName[data.runStatus]

  return (
    <div
      className={cn(
        'relative flex rounded-2xl border',
        isSelected ? 'border-primary' : 'border-transparent',
        !model.enabled && 'opacity-70',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => data.onOpen(id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            data.onOpen(id)
          }
        }}
        className={cn(
          'group/node relative w-60 rounded-[15px] border border-transparent bg-card pb-1 transition-colors outline-none',
          isSelected ? 'bg-accent/70' : 'hover:bg-accent/45',
          statusBorder,
        )}
      >
        <NodeActionBar
          selected={isSelected}
          canDuplicate={canDelete}
          canDelete={canDelete}
          onDuplicate={() => data.onDuplicateNode(id)}
          onDelete={() => data.onDeleteNode(id)}
        />

        {model.kind !== 'input' && (
          <NodeHandle
            nodeId={id}
            data={data}
            handleId="target"
            handleType="target"
            connected={data.targetConnected}
            isConnectable={model.enabled}
          />
        )}

        <div className="flex items-center rounded-t-2xl px-3 pt-3 pb-2">
          <div className="mr-1 flex min-w-0 grow items-center">
            <BlockIcon kind={model.kind} size="md" className="mr-2 shrink-0" />
            <div className="flex min-w-0 grow items-center text-xs font-semibold tracking-wide text-foreground uppercase">
              <div title={model.name} className="min-w-0 grow truncate">{model.name}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <NodeHeaderMeta status={data.runStatus} enabled={model.enabled} />
          </div>
        </div>

        <Body {...props} />

        <NodeDescription model={model} />
      </div>
    </div>
  )
})
