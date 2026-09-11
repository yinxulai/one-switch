import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeBranchRow } from '../components/node-sections'
import { WORKFLOW_PROTOCOLS } from '../field-hints'
import type { RouteNodeProps } from '../node-data'

/**
 * 协议发现节点视图。
 * 分支行逐行对齐 Dify `nodes/if-else/node.tsx`：左侧小字为协议 id，右侧为 IF / ELIF / ELSE，
 * 端口挂在行尾，偏移量由 NodeHandle 的 align="row" 统一处理。
 */
export function ProtocolDiscoveryNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model

  return (
    <NodeBody className="pb-1">
      {WORKFLOW_PROTOCOLS.map((protocol, index) => {
        const isFallback = protocol === 'unknown'
        const label = isFallback ? 'ELSE' : index === 0 ? 'IF' : 'ELIF'

        return (
          <NodeBranchRow key={protocol} caption={protocol} label={label}>
            <NodeHandle
              nodeId={id}
              data={data}
              handleId={protocol}
              handleType="source"
              connected={data.connectedSourcePorts.includes(protocol)}
              align="row"
              isConnectable={model.enabled}
            />
          </NodeBranchRow>
        )
      })}
    </NodeBody>
  )
}
