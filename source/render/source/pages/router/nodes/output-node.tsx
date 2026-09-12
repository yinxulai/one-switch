import { NodeBody, NodeRowList } from '../components/node-sections'
import type { RouteNodeProps } from '../node-data'
import type { OutputNode } from '@common/router/types'

/** 出口节点视图：只展示输出策略，没有 source 端口。 */
export function OutputNodeView(props: RouteNodeProps) {
  const { data } = props
  const model = data.model as OutputNode

  return (
    <NodeBody className="mb-1 py-1">
      <NodeRowList>
        <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1 system-xs-regular text-text-secondary">
          {model.summaryLevel === 'detailed' ? '详细摘要' : '简要摘要'}
        </div>
        <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1 system-xs-regular text-text-secondary">
          {model.includeTrace ? '含 trace' : '不含 trace'}
        </div>
      </NodeRowList>
    </NodeBody>
  )
}
