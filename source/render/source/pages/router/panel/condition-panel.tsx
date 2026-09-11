import { useCallback, useMemo } from 'react'
import { Plus } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DifyButton } from '../components/dify-button'
import { createConditionCase, createConditionRule, getOperatorsByType } from '../graph-model'
import type { NodePanelProps } from '../node-data'
import type {
  ConditionLogicalOperator,
  ConditionNode,
  ConditionOperator,
  SchemaValueType,
} from '../types'
import {
  NodePanelCard,
  NodePanelField,
  NodePanelGroupHeader,
  NodePanelHint,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

export function ConditionPanel(props: NodePanelProps) {
  const { model, nodeModels, conditionFieldHints, update } = props
  const node = model as ConditionNode

  const fieldTypeOf = useCallback(
    (fieldPath: string, fallback: SchemaValueType): SchemaValueType =>
      conditionFieldHints.find(item => item.path === fieldPath)?.valueType ?? fallback,
    [conditionFieldHints],
  )

  const sourceNameOf = useMemo(
    () => new Map(nodeModels.map(item => [item.id, item.name])),
    [nodeModels],
  )

  return (
    <div className="grid gap-3">
      {conditionFieldHints.length === 0 && (
        <NodePanelHint>暂无可用字段，请先将会产生字段的节点连接到当前节点上游。</NodePanelHint>
      )}

      {node.cases.map((conditionCase, caseIndex) => (
        <NodePanelCard key={conditionCase.id} className="gap-3 p-3">
          <NodePanelGroupHeader
            title={`IF 分支 ${caseIndex + 1}`}
            action={(
              <DifyButton
                variant="ghost-destructive"
                disabled={node.cases.length <= 1}
                onClick={() => update(current => current.kind === 'condition'
                  ? { ...current, cases: current.cases.filter(item => item.id !== conditionCase.id) }
                  : current)}
              >
                删除分支
              </DifyButton>
            )}
          />

          <NodePanelField label="分支名称">
            <Input
              value={conditionCase.name}
              onChange={event => update(current => current.kind === 'condition'
                ? {
                  ...current,
                  cases: current.cases.map(item => item.id === conditionCase.id
                    ? { ...item, name: event.target.value }
                    : item),
                }
                : current)}
            />
          </NodePanelField>

          <NodePanelField label="条件组合方式">
            <Select
              value={conditionCase.logicalOperator}
              onValueChange={value => update(current => current.kind === 'condition'
                ? {
                  ...current,
                  cases: current.cases.map(item => item.id === conditionCase.id
                    ? { ...item, logicalOperator: value as ConditionLogicalOperator }
                    : item),
                }
                : current)}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="logical operator" /></SelectTrigger>
              <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="and">全部满足（AND）</SelectItem>
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="or">任一满足（OR）</SelectItem>
              </SelectContent>
            </Select>
          </NodePanelField>

          <div className="grid gap-2">
            {conditionCase.conditions.map((rule, ruleIndex) => {
              const available = conditionFieldHints.some(field => field.path === rule.fieldPath)
              const fieldType = fieldTypeOf(rule.fieldPath, rule.valueType)
              const operators = getOperatorsByType(fieldType)

              const patchRule = (patch: Record<string, unknown>) => update(current => current.kind === 'condition'
                ? {
                  ...current,
                  cases: current.cases.map(item => item.id === conditionCase.id
                    ? {
                      ...item,
                      conditions: item.conditions.map((condition, index) =>
                        index === ruleIndex ? { ...condition, ...patch } : condition),
                    }
                    : item),
                }
                : current)

              return (
                <div key={`${conditionCase.id}-${ruleIndex}`} className="grid gap-2 rounded-lg bg-workflow-block-parma-bg p-2">
                  <NodePanelGroupHeader
                    title={`条件 ${ruleIndex + 1}`}
                    action={(
                      <DifyButton
                        variant="ghost-destructive"
                        disabled={conditionCase.conditions.length <= 1}
                        onClick={() => update(current => current.kind === 'condition'
                          ? {
                            ...current,
                            cases: current.cases.map(item => item.id === conditionCase.id
                              ? {
                                ...item,
                                conditions: item.conditions.filter((_, index) => index !== ruleIndex),
                              }
                              : item),
                          }
                          : current)}
                      >
                        删除
                      </DifyButton>
                    )}
                  />

                  <NodePanelField label="字段路径（上游 schema）">
                    <Select
                      value={rule.fieldPath}
                      onValueChange={value => update(current => {
                        if (current.kind !== 'condition') return current
                        const field = conditionFieldHints.find(item => item.path === value)
                        const nextType = field?.valueType ?? rule.valueType
                        return {
                          ...current,
                          cases: current.cases.map(item => item.id === conditionCase.id
                            ? {
                              ...item,
                              conditions: item.conditions.map((condition, index) => index === ruleIndex
                                ? {
                                  ...condition,
                                  fieldPath: value,
                                  valueType: nextType,
                                  enumOptions: field?.enumOptions,
                                  operator: getOperatorsByType(nextType)[0] ?? 'equals',
                                }
                                : condition),
                            }
                            : item),
                        }
                      })}
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder="field path" /></SelectTrigger>
                      <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                        {conditionFieldHints.map(field => (
                          <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                            {/* 名称前置：先看「来自哪个节点」，再看具体字段路径与类型。 */}
                            {sourceNameOf.get(field.sourceNodeId) ?? field.sourceNodeId} · {field.path} · {field.valueType}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </NodePanelField>

                  {!available && (
                    <NodePanelHint tone="warning">
                      当前字段 {rule.fieldPath} 不再由任何已连接的上游节点提供。
                    </NodePanelHint>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <NodePanelField label="字段类型">
                      <Input value={fieldType} disabled />
                    </NodePanelField>

                    <NodePanelField label="操作符">
                      <Select
                        value={rule.operator}
                        onValueChange={value => patchRule({ operator: value as ConditionOperator })}
                      >
                        <SelectTrigger className="w-full"><SelectValue placeholder="operator" /></SelectTrigger>
                        <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                          {operators.map(operator => (
                            <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={operator} value={operator}>{operator}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </NodePanelField>
                  </div>

                  {rule.operator !== 'exists'
                    && rule.operator !== 'isTrue'
                    && rule.operator !== 'isFalse'
                    && rule.operator !== 'empty'
                    && rule.operator !== 'notEmpty' && (
                      <NodePanelField label="比较值">
                        <Input
                          value={rule.value ?? ''}
                          onChange={event => patchRule({ value: event.target.value })}
                        />
                      </NodePanelField>
                  )}

                  {rule.operator === 'between' && (
                    <NodePanelField label="上界值">
                      <Input
                        value={rule.secondaryValue ?? ''}
                        onChange={event => patchRule({ secondaryValue: event.target.value })}
                      />
                    </NodePanelField>
                  )}
                </div>
              )
            })}
          </div>

          <DifyButton
            onClick={() => update(current => current.kind === 'condition'
              ? {
                ...current,
                cases: current.cases.map(item => item.id === conditionCase.id
                  ? { ...item, conditions: [...item.conditions, createConditionRule()] }
                  : item),
              }
              : current)}
          >
            <Plus className="size-3.5" aria-hidden /> 添加条件
          </DifyButton>
        </NodePanelCard>
      ))}

      <DifyButton
        onClick={() => update(current => current.kind === 'condition'
          ? { ...current, cases: [...current.cases, createConditionCase()] }
          : current)}
      >
        <Plus className="size-3.5" aria-hidden /> 添加 IF 分支
      </DifyButton>

      <NodePanelHint>
        每个分支与 ELSE 的目标节点通过画布连线设置；首个命中的分支生效，否则走 ELSE。
      </NodePanelHint>
    </div>
  )
}
