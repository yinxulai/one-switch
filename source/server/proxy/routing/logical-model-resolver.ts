import { isBuiltInDefaultLogicalModel } from '@common/schemas'
import type { LogicalModel } from '@common/schemas'

/** 一次逻辑模型解析的结果。 */
export interface LogicalModelResolution {
  /** 本次请求要用的逻辑模型。 */
  logicalModel: LogicalModel
  /** 请求模型自己命中了这个逻辑模型；为假表示走的是回落分支。 */
  matched: boolean
}

/**
 * 内建「模型直达」规则：请求模型命中某个已启用逻辑模型的 id 或 name 就用它，
 * 否则回落到内建的默认逻辑模型（`isBuiltInDefaultLogicalModel`）。
 *
 * 这条规则与路由工作台里的默认策略预设（`createDefaultPolicyGraph`，即 `model-direct`）
 * 表达的是同一件事：条件「请求模型在逻辑模型列表里」+ 直连分支 + 兜底落点。
 * 唯一放宽的地方是这里额外认逻辑模型的 name（预设的条件只比 `logicalModels[*].id`）：
 * 客户端的契约本来就是填逻辑模型 id，多认一个名字只是对老客户端宽容。
 * 它现在还留在代码里，是因为代理链路不读取也不执行用户保存的路由图——
 * `runWorkflow` 目前唯一的落点是试运行接口 `POST /api/router/run`。
 * 等路由图真正驱动代理后，这个模块连同它的两个调用点（HTTP / WebSocket 入口）一起删除即可：
 * `logical-model-resolver.test.ts` 里「与默认策略预设等价」的用例就是那条可安全删除的判据。
 *
 * 传入 `null` 表示「这次请求本来就没有模型名」——WebSocket 握手阶段还没有任何报文，
 * 读不出请求模型，此时必然走回落分支。
 */
export function resolveLogicalModel(models: LogicalModel[], requestedModel: string | null): LogicalModelResolution | null {
  const enabledModels = models.filter(model => model.enabled)
  const requested = requestedModel?.trim() ?? ''
  if (requested !== '') {
    const matchedModel = enabledModels.find(model => model.id === requested || model.name === requested)
    if (matchedModel) return { logicalModel: matchedModel, matched: true }
  }
  const fallbackModel = enabledModels.find(isBuiltInDefaultLogicalModel)
  return fallbackModel ? { logicalModel: fallbackModel, matched: false } : null
}
