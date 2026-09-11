import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeRow, NodeRowList } from '../components/node-sections'
import type { RouteNodeProps } from '../node-data'

/** 入口字段，行结构与 Dify `nodes/start/node.tsx` 的变量行一致（h-6 圆角浅底 + 右侧类型）。 */
const INPUT_FIELDS: { name: string; type: string }[] = [
  { name: 'request', type: 'object' },
  { name: 'queues', type: 'array' },
  { name: 'metadata', type: 'object' },
]

/** 输入节点视图：只展示入口字段，端口固定在标题行。 */
export function InputNodeView(props: RouteNodeProps) {
  const { id, data } = props

  return (
    <>
      <NodeBody className="mb-1 py-1">
        <NodeRowList>
          {INPUT_FIELDS.map(field => (
            <NodeRow key={field.name} name={field.name} meta={field.type} />
          ))}
        </NodeRowList>
      </NodeBody>

      <NodeHandle
        nodeId={id}
        data={data}
        handleId="out"
        handleType="source"
        connected={data.connectedSourcePorts.includes('out')}
        isConnectable={data.model.enabled}
      />
    </>
  )
}
