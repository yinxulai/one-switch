import { NodeHandle } from '../components/node-handle'
import { NodeBody, NodeBranchRow, NodeConditionChip } from '../components/node-sections'
import type { RouteNodeProps } from '../node-data'
import { conditionOperatorMeta, type ConditionNode } from '../types'

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
        <div className="flex h-6 items-center space-x-1 rounded-md bg-workflow-block-parma-bg px-1 system-xs-regular text-text-secondary">
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
                <NodeConditionChip className="h-6 space-x-1 px-1 system-xs-regular text-text-secondary">未配置条件</NodeConditionChip>
              )}

              {conditions.map((condition, conditionIndex) => (
                <div key={`${condition.fieldPath}-${conditionIndex}`} className="relative">
                  <NodeConditionChip className="h-6">
                    {/* 变量名可收缩截断，操作符固定宽度，值占满剩余空间：
                        三者都不换行，保证条件条目恒定单行 24px，与 Dify `condition-value.tsx` 一致。 */}
                    <span className="min-w-0 truncate px-1 system-xs-medium text-text-secondary">
                      {condition.fieldPath}
                    </span>
                    {/* 卡片上展示中文名（比 `equals` 好读），原始标识符与语义说明作为悬浮提示。 */}
                    <span
                      className="mx-1 shrink-0 cursor-help text-xs font-medium text-text-primary"
                      title={`${condition.operator} · ${conditionOperatorMeta(condition.operator).description}`}
                    >
                      {conditionOperatorMeta(condition.operator).label}
                    </span>
                    <span className="min-w-0 grow truncate px-1.5 text-xs/6 text-text-secondary">
                      {condition.valueSource === 'field'
                        ? condition.valueFieldPath || '—'
                        : condition.value || '—'}
                    </span>
                  </NodeConditionChip>

                  {conditionIndex !== conditions.length - 1 && (
                    <div className="absolute right-1 -bottom-2.5 z-10 system-2xs-medium-uppercase text-text-accent">
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
