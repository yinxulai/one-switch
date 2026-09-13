import { SquareCode, Timer } from 'lucide-react'

import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeRow, NodeRowList } from '../components/node-sections'
import { useTranslation } from '@/i18n/provider'
import type { RouteNodeProps } from '../node-data'
import type { ScriptNode } from '@common/router/types'

/**
 * JS 脚本节点视图。
 *
 * 只展示「结果写到哪 + 脚本规模 + 超时」：节点卡片是画布上的语义锚点，
 * 把代码贴在卡片上会撑破整张图的可读性，源码统一在右侧面板里编辑。
 */
export function ScriptNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model as ScriptNode
  const resultPath = model.resultPath.trim()
  const lineCount = model.code.split('\n').filter(line => line.trim()).length
  const t = useTranslation()

  return (
    <>
      <NodeBody className="mb-1 gap-1 py-1">
        <NodeRowList>
          <NodeRow
            name={resultPath || t('router.summary.resultPathEmpty')}
            meta={t('router.nodeView.writeBackMeta')}
            icon={<SquareCode className="size-3.5 shrink-0 text-text-accent" aria-hidden />}
          />
          <NodeRow
            name={lineCount > 0 ? t('router.nodeView.scriptLines', { count: lineCount }) : t('router.nodeView.scriptEmpty')}
            meta={`${model.timeoutMilliseconds} ms`}
            icon={<Timer className="size-3.5 shrink-0 text-text-accent" aria-hidden />}
          />
        </NodeRowList>
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
