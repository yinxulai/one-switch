import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeBranchRow, NodeConditionChip } from '../components/node-sections'
import type { RouteNodeProps } from '../node-data'
import type { ConditionNode } from '../types'

/**
 * 条件节点视图。
 * 逐行对齐 Dify `nodes/if-else/node.tsx`：
 * 分支行（CASE n / IF|ELIF）+ 行内条件条目（`bg-muted` 圆角容器 + 变量 + 操作符 + 值），
 * 多条件之间按逻辑操作符插入 AND / OR 标记，最后一行固定为 ELSE。
 */
export function ConditionNodeView(props: RouteNodeProps) {
  const { id, data } = props
  const model = data.model as ConditionNode
  const cases = model.cases

  return (
    <NodeBody className="pb-1">
      {cases.length === 0 && (
        <div className="flex h-6 items-center rounded-md bg-muted px-1 text-xs text-muted-foreground">
          尚未配置分支，所有请求都会走 ELSE
        </div>
      )}

      {cases.map((conditionCase, index) => {
        const { conditions, logicalOperator } = conditionCase

        return (
          <div key={conditionCase.id}>
            <NodeBranchRow
              caption={cases.length > 1 ? `CASE ${index + 1}` : undefined}
              label={index === 0 ? 'IF' : 'ELIF'}
            >
              <NodeHandle
                nodeId={id}
                data={data}
                handleId={conditionCase.id}
                handleType="source"
                connected={data.connectedSourcePorts.includes(conditionCase.id)}
                align="row"
                isConnectable={model.enabled}
              />
            </NodeBranchRow>

            <div className="space-y-0.5">
              {conditions.length === 0 && (
                <NodeConditionChip className="h-6 px-1 text-xs text-muted-foreground">未配置条件</NodeConditionChip>
              )}

              {conditions.map((condition, conditionIndex) => (
                <div key={`${condition.fieldPath}-${conditionIndex}`}>
                  <NodeConditionChip>
                    <span className="truncate px-1.5 text-xs/6 text-foreground">{condition.fieldPath}</span>
                    <span className="mx-1 shrink-0 text-xs font-medium text-foreground">{condition.operator}</span>
                    <span className="grow truncate px-1.5 text-xs/6 text-muted-foreground">{condition.value || '—'}</span>
                  </NodeConditionChip>

                  {conditionIndex !== conditions.length - 1 && (
                    <div className="pr-1 text-right text-[10px] leading-4 font-medium text-primary uppercase">
                      {logicalOperator === 'and' ? 'AND' : 'OR'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      <NodeBranchRow label="ELSE">
        <NodeHandle
          nodeId={id}
          data={data}
          handleId="else"
          handleType="source"
          connected={data.connectedSourcePorts.includes('else')}
          align="row"
          isConnectable={model.enabled}
        />
      </NodeBranchRow>
    </NodeBody>
  )
}
