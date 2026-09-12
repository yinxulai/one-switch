import { ListChecks, Repeat2 } from 'lucide-react'

import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeBranchRow, NodeRow, NodeRowList } from '../components/node-sections'
import { ITERATION_COLLECT_MODE_LABELS } from '../node-meta'
import type { RouteNodeProps } from '../node-data'
import type { IterationNode } from '@common/router/types'

/**
 * 遍历迭代节点视图。
 *
 * Dify 的 iteration 节点没有纵向的 body 端口，靠隐式子图表达循环体；
 * 这里复用条件节点的「分支行 + 行尾端口」结构，把 `body`（循环体）和 `out`（完成）
 * 两个端口做成两行，回边由用户自己从循环体末端连回来，图的拓扑完全显式。
 */
export function IterationNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model as IterationNode
  const sourcePath = model.sourcePath.trim()
  const collectPath = model.collectPath.trim()

  return (
    <NodeBody className="pb-1">
      <NodeRowList className="pb-1">
        <NodeRow
          name={sourcePath || '未配置遍历来源'}
          meta="遍历"
          icon={<Repeat2 className="size-3.5 shrink-0 text-text-accent" aria-hidden />}
        />
        <NodeRow
          name={collectPath || '未配置结果路径'}
          meta={ITERATION_COLLECT_MODE_LABELS[model.collectMode]}
          icon={<ListChecks className="size-3.5 shrink-0 text-text-accent" aria-hidden />}
        />
      </NodeRowList>

      <NodeBranchRow caption={`上限 ${model.maxIterations} 轮`} label="循环体">
        <NodeHandle
          nodeId={id}
          data={data}
          handleId="body"
          handleType="source"
          connected={data.connectedSourcePorts.includes('body')}
          align="row"
          isConnectable={model.enabled}
        />
      </NodeBranchRow>

      <NodeBranchRow label="完成">
        <NodeHandle
          nodeId={id}
          data={data}
          handleId="out"
          handleType="source"
          connected={data.connectedSourcePorts.includes('out')}
          align="row"
          isConnectable={model.enabled}
        />
      </NodeBranchRow>
    </NodeBody>
  )
}
