import { describe, expect, it } from 'vitest'

import { BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME } from '@common/schemas'
import type { LogicalModel } from '@common/schemas'
import { runWorkflow } from '@render/source/pages/router/engine'
import { createDefaultPolicyGraph } from '@render/source/pages/router/graph-model'
import { resolveLogicalModel } from './logical-model-resolver'

/**
 * 内建「模型直达」规则的回归测试。
 *
 * 这条规则决定了「客户端填什么模型名会打到哪个逻辑模型」，是代理链路里最容易被改坏、
 * 也最难从现象上看出来的一环：错配了不会报错，只是安静地把请求送到了另一个上游。
 */

function logicalModel(id: string, overrides: Partial<LogicalModel> = {}): LogicalModel {
  return {
    id,
    name: id,
    description: '',
    enabled: true,
    createdTime: 0,
    updatedTime: 0,
    deletedTime: null,
    ...overrides,
  }
}

/** 内建默认逻辑模型：种子写入时 id 与 name 都是 `default`。 */
const defaultModel = logicalModel(BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME)

const fastModel = logicalModel('model-fast', { name: 'Model Fast' })

describe('resolveLogicalModel', () => {
  it('请求模型命中逻辑模型 id 时直连它', () => {
    expect(resolveLogicalModel([defaultModel, fastModel], 'model-fast')).toEqual({ logicalModel: fastModel, matched: true })
  })

  it('请求模型命中逻辑模型 name 时同样直连它', () => {
    // 客户端习惯填「人看的模型名」，所以 name 必须和 id 一样能命中。
    expect(resolveLogicalModel([defaultModel, fastModel], 'Model Fast')).toEqual({ logicalModel: fastModel, matched: true })
  })

  it('请求模型命中默认逻辑模型本身时也算命中，不再标记成回落', () => {
    expect(resolveLogicalModel([defaultModel, fastModel], 'default')).toEqual({ logicalModel: defaultModel, matched: true })
  })

  it('未命中时回落到内建默认逻辑模型，并标记 matched=false', () => {
    // `matched` 是后续判断「用户填的模型是不是被认出来了」的唯一依据，回落时必须为假。
    expect(resolveLogicalModel([defaultModel, fastModel], 'gpt-4o-mini')).toEqual({ logicalModel: defaultModel, matched: false })
  })

  it('内建默认逻辑模型被停用时不再兜底，直接返回 null', () => {
    // 已经有一个启用的 default 才算「配置好了」。用户主动停用它就是在表达
    // 「不要让没认出来的模型随便落到某个上游」，此时宁可拒绝也不能乱猜一个。
    const disabledDefault = logicalModel(BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME, { enabled: false })
    expect(resolveLogicalModel([disabledDefault, fastModel], 'gpt-4o-mini')).toBeNull()
  })

  it('停用的逻辑模型既不参与命中，也不能作为兜底', () => {
    const disabledFast = logicalModel('model-fast', { name: 'Model Fast', enabled: false })
    expect(resolveLogicalModel([defaultModel, disabledFast], 'model-fast')).toEqual({ logicalModel: defaultModel, matched: false })
    expect(resolveLogicalModel([disabledFast], 'anything')).toBeNull()
  })

  it('默认逻辑模型缺失（被人删了）时返回 null，由入口回 503', () => {
    // 启动时 `ensureDefaultLogicalModel` 会补回来，但当前这次请求不能编一个不存在的落点。
    expect(resolveLogicalModel([fastModel], 'gpt-4o-mini')).toBeNull()
  })

  it('一个已启用逻辑模型都没有时返回 null，由入口回 503', () => {
    expect(resolveLogicalModel([], 'gpt-4o-mini')).toBeNull()
    expect(resolveLogicalModel([logicalModel('model-fast', { enabled: false })], 'gpt-4o-mini')).toBeNull()
  })

  it('没有模型名的请求（WebSocket 握手）必然走回落分支', () => {
    // 握手阶段还没有任何报文，读不出请求模型，此时只有回落一条路可走。
    expect(resolveLogicalModel([defaultModel, fastModel], null)).toEqual({ logicalModel: defaultModel, matched: false })
    expect(resolveLogicalModel([defaultModel, fastModel], '')).toEqual({ logicalModel: defaultModel, matched: false })
    expect(resolveLogicalModel([defaultModel, fastModel], '   ')).toEqual({ logicalModel: defaultModel, matched: false })
  })

  it('请求模型前后的空白被忽略，不会因为客户端多打了个空格就打错上游', () => {
    expect(resolveLogicalModel([defaultModel, fastModel], '  model-fast  ')).toEqual({ logicalModel: fastModel, matched: true })
  })

  it('id 与 name 撞上不同逻辑模型时以 id 为准', () => {
    // 按顺序找第一个匹配项，id 判断先于 name；这里把两个候选都放进列表来固定这个优先级。
    const byId = logicalModel('model-fast', { name: '别的名字' })
    const byName = logicalModel('model-other', { name: 'model-fast' })
    expect(resolveLogicalModel([byId, byName], 'model-fast')).toEqual({ logicalModel: byId, matched: true })
  })
})

/**
 * 与路由工作台「默认策略」（预设 `model-direct`）的一致性。
 *
 * 这两处表达的是同一条规则：请求模型命中逻辑模型就直连，否则落到默认逻辑模型。
 * 这份测试就是那条「可以安全删掉 `logical-model-resolver.ts`」的判据——
 * 等路由图真正驱动代理之后，这个文件连同解析器一起删掉即可。
 */
describe('与默认策略预设等价', () => {
  const models = [logicalModel(BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME), fastModel]

  /** 跑一遍默认策略预设，取它算出来的落点。 */
  async function landingModelIds(requestedModel: string): Promise<string[]> {
    const result = await runWorkflow(createDefaultPolicyGraph(models), {
      request: { path: '/v1/chat/completions', headers: { 'content-type': 'application/json' }, body: { model: requestedModel } },
      logicalModels: models,
      metadata: {},
    })
    return (result.outputPayload as { route: { modelIds: string[] } }).route.modelIds
  }

  it.each(['default', 'model-fast', 'gpt-4o-mini', ''])('请求模型「%s」在两处得到同一个落点', async requestedModel => {
    const resolution = resolveLogicalModel(models, requestedModel)
    // 一个启用逻辑模型都没有时解析器返回 null，预设这边对应的是「没有落点」。
    expect(await landingModelIds(requestedModel)).toEqual(resolution ? [resolution.logicalModel.id] : [])
  })

  it('解析器额外接受逻辑模型的名字，而预设条件只认 id', () => {
    // 预设的条件是 `route.requestedModel in logicalModels[*].id`，只比 id；
    // 客户端的契约本来就是「填逻辑模型 id」（`LogicalModelIdSchema` 即对外模型标识），
    // 解析器多认一个名字只是宽容，不改变上面那条等价关系——所以它在这里不参与等价断言。
    expect(resolveLogicalModel(models, 'Model Fast')?.logicalModel.id).toBe('model-fast')
  })
})
