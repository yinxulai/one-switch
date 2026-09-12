import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/provider'
import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeRow, NodeRowList } from '../components/node-sections'
import type { RouteNodeProps } from '../node-data'
import type { ControlInputNode } from '@common/router/types'

/**
 * 控制输入节点视图。
 * 只保留唯一的 `out` 端口：引擎实际只按 `out` 继续路由，
 * 旧实现里按控制项 id 生成的端口不会被引擎识别，属于无效端口，已移除。
 * 行结构对齐 Dify `nodes/start/node.tsx`：h-6 圆角浅底 + 名称 + 右侧 key。
 */
export function ControlInputNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model as ControlInputNode
  const controls = model.controls
  const t = useTranslation()

  return (
    <>
      <NodeBody className="mb-1 py-1">
        {controls.length === 0
          ? (
            <div className="flex h-6 items-center rounded-md bg-workflow-block-parma-bg px-1 system-xs-regular text-text-tertiary">
              {t('router.controlInput.empty')}
            </div>
          )
          : (
            <NodeRowList>
              {controls.map(control => (
                <NodeRow
                  key={control.id}
                  name={control.label}
                  meta={<span className="font-mono normal-case">{control.key}</span>}
                  icon={(
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        control.enabled ? 'bg-state-success-solid' : 'bg-state-base-handle',
                      )}
                    />
                  )}
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
