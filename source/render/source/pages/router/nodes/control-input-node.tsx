import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeRow, NodeRowList } from '../components/node-sections'
import type { RouteNodeProps } from '../node-data'
import type { ControlInputNode } from '../types'

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

  return (
    <>
      <NodeBody className="mb-1 py-1">
        {controls.length === 0
          ? <div className="flex h-6 items-center rounded-md bg-muted px-1 text-xs text-muted-foreground">尚未添加控制项</div>
          : (
            <NodeRowList>
              {controls.map(control => (
                <NodeRow
                  key={control.id}
                  name={control.label}
                  meta={<span className="font-mono normal-case">{control.key}</span>}
                  icon={(
                    <span
                      className={control.enabled ? 'size-1.5 shrink-0 rounded-full bg-emerald-500' : 'size-1.5 shrink-0 rounded-full bg-muted-foreground/40'}
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
