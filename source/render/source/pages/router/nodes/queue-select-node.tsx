import { Layers, Sparkles } from 'lucide-react'

import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeRow, NodeRowList } from '../components/node-sections'
import type { RouteNodeProps } from '../node-data'
import type { QueueSelectNode } from '../types'

/** 队列选择节点视图：展示取值方式与落点队列，行结构对齐 Dify `nodes/start/node.tsx` 的变量行。 */
export function QueueSelectNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model as QueueSelectNode
  const followRequestModel = model.mode === 'follow-request-model'
  const visibleQueueIds = followRequestModel ? model.fallbackQueueIds : model.queueIds

  return (
    <>
      <NodeBody className="mb-1 gap-1 py-1">
        {followRequestModel && (
          <NodeRow
            name="跟随请求模型"
            meta="默认策略"
            icon={<Sparkles className="size-3.5 shrink-0 text-text-accent" aria-hidden />}
          />
        )}

        {visibleQueueIds.length === 0
          ? (
            <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1 system-xs-regular text-text-tertiary">
              {followRequestModel ? '兜底队列：default' : '尚未选择逻辑队列'}
            </div>
          )
          : (
            <NodeRowList>
              {visibleQueueIds.map(queueId => (
                <NodeRow
                  key={queueId}
                  name={queueId}
                  meta={followRequestModel ? '兜底' : undefined}
                  icon={<Layers className="size-3.5 shrink-0 text-text-accent" aria-hidden />}
                />
              ))}
            </NodeRowList>
          )}
      </NodeBody>

      <NodeHandle
        nodeId={id}
        data={data}
        handleId="out"
        handleType="source"
        connected={data.connectedSourcePorts.includes('out')}
        isConnectable={model.enabled}
      />
    </>
  )
}
