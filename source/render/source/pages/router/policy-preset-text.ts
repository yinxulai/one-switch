import type { RouterPolicyPresetId } from '@common/router/presets'
import type { UiCatalogKey } from '@common/i18n/catalogs'

/**
 * 策略预设的展示文案键。
 *
 * 预设本身（`@common/router/presets.ts`）只保留标识符与建图函数 —— 它会被服务端引用，
 * 而服务端没有「界面语言」这个概念；名称与说明是纯展示内容，因此只放在渲染层目录里。
 * 表用 `RouterPolicyPresetId` 作键，新增预设时漏配会在类型检查阶段被拦住。
 */
export interface PolicyPresetTextKeys {
  name: UiCatalogKey
  description: UiCatalogKey
}

export const POLICY_PRESET_TEXT_KEYS: Record<RouterPolicyPresetId, PolicyPresetTextKeys> = {
  'model-direct': { name: 'router.policy.model-direct.name', description: 'router.policy.model-direct.description' },
  'ua-source-routing': { name: 'router.policy.ua-source-routing.name', description: 'router.policy.ua-source-routing.description' },
  'llm-complexity-routing': { name: 'router.policy.llm-complexity-routing.name', description: 'router.policy.llm-complexity-routing.description' },
  'script-routing': { name: 'router.policy.script-routing.name', description: 'router.policy.script-routing.description' },
}

/**
 * 按预设 id 取文案键。
 *
 * `activePolicyId` 来自**图内容比对的结论**（客户端算出来的字符串），类型上不是联合字面量，
 * 所以这里刻意放宽入参类型并在表外返回 `undefined`，由调用方决定兜底显示什么。
 */
export function policyPresetTextKeys(id: string): PolicyPresetTextKeys | undefined {
  return (POLICY_PRESET_TEXT_KEYS as Record<string, PolicyPresetTextKeys>)[id]
}
