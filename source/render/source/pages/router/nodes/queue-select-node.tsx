import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeRow, NodeRowList } from '../components/node-sections'
import type { RouteNodeProps } from '../node-data'
import type { QueueSelectNode } from '../types'

/** 队列选择节点视图：展示已选队列，行结构对齐 Dify 的 `h-6 圆角浅底 + 名称 + 右侧计数`。 */
export function QueueSelectNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model as QueueSelectNode
  const count = model.queueIds.length

  return (
    <>
      <NodeBody className="mb-1 py-1">
        {count === 0
          ? (
            <div className="flex h-6 items-center rounded-md bg-muted px-1 text-xs text-muted-foreground">
              尚未选择逻辑队列
            </div>
          )
          : (
            <NodeRowList>
              {model.queueIds.map(queueId => (
                <NodeRow key={queueId} name={queueId} />
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
