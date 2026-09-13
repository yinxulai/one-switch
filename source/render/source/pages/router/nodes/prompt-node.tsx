import { Sparkles, TextCursorInput } from 'lucide-react'

import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeRow, NodeRowList } from '../components/node-sections'
import { useTranslation } from '@/i18n/provider'
import type { RouteNodeProps } from '../node-data'
import type { PromptNode } from '@common/router/types'

/**
 * LLM 节点视图。
 *
 * 展示「用哪个逻辑模型 + 提示词首行 + 回复写到哪」。
 * 逻辑模型只显示 id，节点卡片不查后端列表：运行结果（trace）会把真实命中的上游写清楚。
 */
export function PromptNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model as PromptNode
  const logicalModelId = model.logicalModelId.trim()
  const promptLine = model.promptTemplate
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)[0] ?? ''
  const t = useTranslation()

  return (
    <>
      <NodeBody className="mb-1 gap-1 py-1">
        <NodeRowList>
          <NodeRow
            name={logicalModelId || t('router.summary.logicalModelEmpty')}
            meta={t('router.nodeView.logicalModelMeta')}
            icon={<Sparkles className="size-3.5 shrink-0 text-text-accent" aria-hidden />}
          />
          <NodeRow
            name={promptLine || t('router.nodeView.promptEmpty')}
            meta={model.resultPath.trim() || t('router.nodeView.writeBackPathEmpty')}
            icon={<TextCursorInput className="size-3.5 shrink-0 text-text-accent" aria-hidden />}
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
