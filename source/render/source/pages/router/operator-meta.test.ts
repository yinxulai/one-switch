import { describe, expect, it } from 'vitest'
import {
  ALL_CONDITION_OPERATORS,
  CONDITION_OPERATOR_META,
  DEFAULT_OPERATOR_SET,
  conditionOperatorMeta,
} from '@common/router/types'
import type { ConditionOperator } from '@common/router/types'

/**
 * 操作符的中文名与说明是用户唯一能读到的语义来源，所以这里锁三件事：
 * 每个操作符都有文案、文案不重复到无法区分、类型候选集不出现表外的操作符。
 */
describe('条件操作符元信息', () => {
  it('全部操作符都有中文名称与说明', () => {
    for (const operator of ALL_CONDITION_OPERATORS) {
      const meta = CONDITION_OPERATOR_META[operator]
      expect(meta, operator).toBeDefined()
      expect(meta.label.trim(), operator).not.toBe('')
      expect(meta.description.trim(), operator).not.toBe('')
      // 中文名只用于展示，不要顺手把标识符抄进去。
      expect(meta.label, operator).not.toBe(operator)
    }
  })

  it('元信息表与操作符清单一一对应，不残留已删除的操作符', () => {
    expect(Object.keys(CONDITION_OPERATOR_META).sort()).toEqual([...ALL_CONDITION_OPERATORS].sort())
  })

  it('每种字段类型推荐的操作符都在清单与元信息表内', () => {
    for (const operators of Object.values(DEFAULT_OPERATOR_SET)) {
      for (const operator of operators) {
        expect(ALL_CONDITION_OPERATORS, operator).toContain(operator)
        expect(CONDITION_OPERATOR_META[operator], operator).toBeDefined()
      }
    }
  })

  it('未知操作符退化成兜底文案而不是 undefined', () => {
    const unknown = conditionOperatorMeta('somethingRemoved' as ConditionOperator)
    expect(unknown.label).toBeTruthy()
    expect(unknown.description).toBeTruthy()
  })
})
