import { NodeBody, NodeRowList } from '../components/node-sections'
import { useTranslation } from '@/i18n/provider'
import type { RouteNodeProps } from '../node-data'
import type { OutputNode } from '@common/router/types'

/** 出口节点视图：只展示输出策略，没有 source 端口。 */
export function OutputNodeView(props: RouteNodeProps) {
  const { data } = props
  const model = data.model as OutputNode
  const t = useTranslation()

  return (
    <NodeBody className="mb-1 py-1">
      <NodeRowList>
        <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1 system-xs-regular text-text-secondary">
          {model.summaryLevel === 'detailed' ? t('router.nodeView.summaryDetailed') : t('router.nodeView.summaryBrief')}
        </div>
        <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1 system-xs-regular text-text-secondary">
          {model.includeTrace ? t('router.nodeView.withTrace') : t('router.nodeView.withoutTrace')}
        </div>
      </NodeRowList>
    </NodeBody>
  )
}
