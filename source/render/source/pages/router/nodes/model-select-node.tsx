import { Braces, Layers } from 'lucide-react'

import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeRow, NodeRowList } from '../components/node-sections'
import { useTranslation } from '@/i18n/provider'
import type { RouteNodeProps } from '../node-data'
import type { ModelSelectNode } from '@common/router/types'

/** 逻辑模型选择节点视图：展示取值来源与落点逻辑模型，行结构对齐 Dify `nodes/start/node.tsx` 的变量行。 */
export function ModelSelectNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model as ModelSelectNode
  const fromVariable = model.source === 'variable'
  const variablePath = model.variablePath.trim()
  const visibleModelIds = fromVariable ? model.fallbackModelIds : model.modelIds
  const t = useTranslation()

  return (
    <>
      <NodeBody className="mb-1 gap-1 py-1">
        {fromVariable && (
          <NodeRow
            name={variablePath || t('router.summary.variablePathEmpty')}
            meta={t('router.nodeView.variableMeta')}
            icon={<Braces className="size-3.5 shrink-0 text-text-accent" aria-hidden />}
          />
        )}

        {visibleModelIds.length === 0
          ? (
            <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1 system-xs-regular text-text-tertiary">
              {fromVariable ? t('router.nodeView.fallbackEmpty') : t('router.nodeView.modelEmpty')}
            </div>
          )
          : (
            <NodeRowList>
              {visibleModelIds.map(modelId => (
                <NodeRow
                  key={modelId}
                  name={modelId}
                  meta={fromVariable ? t('router.nodeView.fallbackMeta') : undefined}
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
