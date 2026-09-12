import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanExhaustedReason, PlannerInput, PlanResult, UpstreamTarget } from '@server/proxy/contracts'
import { NO_LANDING_DETAIL, planLandingTargets, type LandingPlan, type LandingPlanMiss } from '@server/proxy/routing/landing-planner'

const mocks = vi.hoisted(() => ({
  plans: new Map<string, PlanResult>(),
  manualModels: new Map<string, string>(),
  planned: [] as string[],
}))

vi.mock('@server/proxy/planners/target-planner', () => ({
  proxyTargetPlanner: {
    id: 'test-planner',
    plan: async (input: PlannerInput) => {
      mocks.planned.push(input.logicalModelId)
      return mocks.plans.get(input.logicalModelId) ?? { targets: [], reason: 'no-available-provider' as PlanExhaustedReason }
    },
  },
}))

vi.mock('@server/proxy/routing/manual-routing', () => ({
  getManualModel: (logicalModelId: string) => mocks.manualModels.get(logicalModelId) ?? null,
}))

afterEach(() => {
  mocks.plans.clear()
  mocks.manualModels.clear()
  mocks.planned = []
})

function target(providerModelId: string): UpstreamTarget {
  return {
    providerId: `prov_${providerModelId}`,
    providerName: 'Provider',
    providerModelId,
    providerModelName: providerModelId,
    apiKeyReference: 'key',
    customAuthHeader: null,
    endpointId: `endpoint_${providerModelId}`,
    protocol: 'openai-completions',
    url: `https://example.test/${providerModelId}`,
    timeoutMilliseconds: 30_000,
  }
}

/** 断言「一个落点都用不了」，把联合类型收窄到失败分支。 */
function expectMiss(plan: LandingPlan): LandingPlanMiss {
  if (plan.logicalModelId !== null) throw new Error(`预期落点全不可用，但拿到了可用落点 ${plan.logicalModelId}`)
  return plan
}

describe('planLandingTargets', () => {
  it('reports a missing landing when the graph returned no logical model', async () => {
    const plan = await planLandingTargets({ logicalModelIds: [], clientProtocol: 'openai-completions' })

    expect(plan).toEqual({ logicalModelId: null, targets: [], manualModelId: null, reason: 'model-not-configured', detail: NO_LANDING_DETAIL })
    expect(mocks.planned).toEqual([])
  })

  it('walks the landings in priority order and stops at the first one with candidates', async () => {
    mocks.plans.set('first', { targets: [], reason: 'no-available-provider', detail: '第一个落点没有可用供应商' })
    mocks.plans.set('second', { targets: [target('model_b')], reason: 'none' })

    const plan = await planLandingTargets({ logicalModelIds: ['first', 'second', 'third'], clientProtocol: 'openai-completions' })

    expect(plan.logicalModelId).toBe('second')
    expect(plan.targets).toHaveLength(1)
    expect(plan.manualModelId).toBeNull()
    // 胜出之后不再往下问：落点顺序是优先级，不是候选池。
    expect(mocks.planned).toEqual(['first', 'second'])
  })

  it('carries the manual model of the winning landing', async () => {
    mocks.manualModels.set('second', 'model_manual')
    mocks.plans.set('second', { targets: [target('model_manual')], reason: 'none' })

    const plan = await planLandingTargets({ logicalModelIds: ['second'], clientProtocol: 'openai-completions' })

    expect(plan).toMatchObject({ logicalModelId: 'second', manualModelId: 'model_manual' })
  })

  it('lists every landing reason when none of them can be used', async () => {
    mocks.plans.set('first', { targets: [], reason: 'no-available-provider', detail: '没有已启用且健康的供应商模型' })
    mocks.plans.set('second', { targets: [], reason: 'no-available-provider' })

    const plan = await planLandingTargets({ logicalModelIds: ['first', 'second'], clientProtocol: 'openai-completions' })

    const miss = expectMiss(plan)
    expect(miss.reason).toBe('no-available-provider')
    // 规划器没给 detail 的落点要用兜底说明，错误信息里不能出现空白。
    expect(miss.detail).toBe('落点逻辑模型都不可用（first: 没有已启用且健康的供应商模型；second: 该逻辑模型没有已启用且健康的供应商模型）')
    expect(mocks.planned).toEqual(['first', 'second'])
  })

  it('reports the manual locking as the reason when any landing failed because of it', async () => {
    mocks.manualModels.set('first', 'model_manual')
    mocks.plans.set('first', { targets: [], reason: 'manual-model-unavailable', detail: '手动指定的 ProviderModel 当前不可用于该协议' })
    mocks.plans.set('second', { targets: [], reason: 'no-available-provider' })

    const plan = await planLandingTargets({ logicalModelIds: ['first', 'second'], clientProtocol: 'openai-completions' })

    expect(expectMiss(plan).reason).toBe('manual-model-unavailable')
  })
})
