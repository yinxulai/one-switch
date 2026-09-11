import { Layers } from 'lucide-react'

import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeRow, NodeRowList } from '../components/node-sections'
import type { RouteNodeProps } from '../node-data'
import type { QueueSelectNode } from '../types'

/** 队列选择节点视图：展示已选队列，行结构对齐 Dify `nodes/start/node.tsx` 的变量行。 */
export function QueueSelectNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model as QueueSelectNode
  const count = model.queueIds.length

  return (
    <>
      <NodeBody className="mb-1 py-1">
        {count === 0
          ? (
            <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1 system-xs-regular text-text-tertiary">
              尚未选择逻辑队列
            </div>
          )
          : (
            <NodeRowList>
              {model.queueIds.map(queueId => (
                <NodeRow
                  key={queueId}
                  name={queueId}
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
