import type { UiCatalogKey } from '@common/i18n/catalogs'
import type { AppTranslator } from '@/i18n/provider'
import type { RequestRewriteRule, RuleAction, RuleTestCase } from './types'

/**
 * 内置规则模板：给用户一个**能直接跑通的起点**，而不是一条空白规则。
 *
 * 与智能路由的内置策略（`@common/router/presets.ts`）是同一个思路，两点差异值得说明：
 *
 * 1. **模板只生成未保存的草稿**。路由预设要服务端在「还没有人保存过路由图」时直接跑，
 *    因此必须放在 `@common`；规则模板没有任何服务端用途，用户点了保存才落库，
 *    所以整套定义留在渲染层，也不需要 `@common` 那边的 CJK 豁免。
 * 2. **名称与说明取自当前界面语言**。规则名保存后就是用户数据（路由预设的节点名同理），
 *    用户在哪门语言下创建，草稿就是哪门语言的写法，之后可以自己改。
 *
 * 模板自带的试跑输入同样是刻意的：套用后直接点「运行测试」就能看到动作真的改了东西，
 * 而不是让用户先自己编一份请求体才知道规则有没有生效。
 */

export type RulePresetId =
  | 'set-user-agent'
  | 'remove-request-header'
  | 'delete-request-field'
  | 'set-request-field'
  | 'replace-request-text'
  | 'replace-response-text'

type RuleActionDraft = Omit<RuleAction, 'id'>
/** 试跑用例的名称由模板统一定，不单独占 key。 */
type RuleTestCaseDraft = Omit<RuleTestCase, 'id' | 'name'>

export interface RulePreset {
  id: RulePresetId
  nameKey: UiCatalogKey
  descriptionKey: UiCatalogKey
  actions: readonly RuleActionDraft[]
  testCase: RuleTestCaseDraft
}

/**
 * 模板清单。
 *
 * 每个模板演示一种动作形态（Header 覆盖 / Header 删除 / Body 删除 / Body 设置 / 字面量替换 / 正则替换），
 * 覆盖 request 与 response 两个阶段；示例字段刻意选三个协议根级都有的名字
 * （`model` / `temperature` / `metadata`），这样模板不写 `match` 也能在任一协议下生效。
 */
export const RULE_PRESETS: readonly RulePreset[] = [
  {
    id: 'set-user-agent',
    nameKey: 'rules.presets.setUserAgent.name',
    descriptionKey: 'rules.presets.setUserAgent.description',
    actions: [{ stage: 'request', target: 'header', operation: 'set', path: 'User-Agent', value: 'OpenAI/Python 1.55.3' }],
    testCase: {
      stage: 'request',
      headers: '{\n  "content-type": "application/json",\n  "user-agent": "curl/8.4.0"\n}',
      body: '{\n  "model": "gpt-4o-mini",\n  "messages": [{ "role": "user", "content": "hello" }]\n}',
      clientProtocol: 'openai-completions',
      upstreamProtocol: 'openai-completions',
      transport: 'http',
    },
  },
  {
    id: 'remove-request-header',
    nameKey: 'rules.presets.removeRequestHeader.name',
    descriptionKey: 'rules.presets.removeRequestHeader.description',
    actions: [{ stage: 'request', target: 'header', operation: 'remove', path: 'cookie' }],
    testCase: {
      stage: 'request',
      headers: '{\n  "content-type": "application/json",\n  "cookie": "session=abc123"\n}',
      body: '{\n  "model": "gpt-4o-mini",\n  "messages": [{ "role": "user", "content": "hello" }]\n}',
      clientProtocol: 'openai-completions',
      upstreamProtocol: 'openai-completions',
      transport: 'http',
    },
  },
  {
    id: 'delete-request-field',
    nameKey: 'rules.presets.deleteRequestField.name',
    descriptionKey: 'rules.presets.deleteRequestField.description',
    actions: [{ stage: 'request', target: 'body', operation: 'remove', path: '$.metadata' }],
    testCase: {
      stage: 'request',
      headers: '{\n  "content-type": "application/json"\n}',
      body: '{\n  "model": "gpt-4o-mini",\n  "metadata": { "traceId": "local-only" },\n  "messages": [{ "role": "user", "content": "hello" }]\n}',
      clientProtocol: 'openai-completions',
      upstreamProtocol: 'openai-completions',
      transport: 'http',
    },
  },
  {
    id: 'set-request-field',
    nameKey: 'rules.presets.setRequestField.name',
    descriptionKey: 'rules.presets.setRequestField.description',
    actions: [{ stage: 'request', target: 'body', operation: 'set', path: '$.temperature', value: '0.7' }],
    testCase: {
      stage: 'request',
      headers: '{\n  "content-type": "application/json"\n}',
      body: '{\n  "model": "gpt-4o-mini",\n  "messages": [{ "role": "user", "content": "hello" }]\n}',
      clientProtocol: 'openai-completions',
      upstreamProtocol: 'openai-completions',
      transport: 'http',
    },
  },
  {
    id: 'replace-request-text',
    nameKey: 'rules.presets.replaceRequestText.name',
    descriptionKey: 'rules.presets.replaceRequestText.description',
    actions: [{ stage: 'request', target: 'body', operation: 'replace', path: '$.model', value: 'gpt-4o-mini', replacement: 'gpt-4o-mini-2024-07-18', regex: false }],
    testCase: {
      stage: 'request',
      headers: '{\n  "content-type": "application/json"\n}',
      body: '{\n  "model": "gpt-4o-mini",\n  "messages": [{ "role": "user", "content": "hello" }]\n}',
      clientProtocol: 'openai-completions',
      upstreamProtocol: 'openai-completions',
      transport: 'http',
    },
  },
  {
    id: 'replace-response-text',
    nameKey: 'rules.presets.replaceResponseText.name',
    descriptionKey: 'rules.presets.replaceResponseText.description',
    actions: [{ stage: 'response', target: 'body', operation: 'replace', path: '$.model', value: '-\\d{4}-\\d{2}-\\d{2}$', replacement: '', regex: true }],
    testCase: {
      stage: 'response',
      headers: '{\n  "content-type": "application/json"\n}',
      body: '{\n  "id": "chatcmpl-demo",\n  "model": "gpt-4o-mini-2024-07-18",\n  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "hi" } }]\n}',
      clientProtocol: 'openai-completions',
      upstreamProtocol: 'openai-completions',
      transport: 'http',
    },
  },
]

/** 空白规则：只有一个占位的 Header 动作，与模板一样是**草稿**。 */
export function createBlankRule(t: AppTranslator): RequestRewriteRule {
  const rule = createDraft(t)
  return {
    ...rule,
    name: t('rules.untitled'),
    actions: [toAction({ stage: 'request', target: 'header', operation: 'set', path: '', value: '' }, rule.id, 0)],
  }
}

/** 按模板生成草稿：名称、说明、动作与一条可直接运行的试跑用例都由模板定。 */
export function createRuleFromPreset(preset: RulePreset, t: AppTranslator): RequestRewriteRule {
  const rule = createDraft(t)
  return {
    ...rule,
    name: t(preset.nameKey),
    description: t(preset.descriptionKey),
    actions: preset.actions.map((action, index) => toAction(action, rule.id, index)),
    testCases: [{ ...preset.testCase, id: `${rule.id}-testcase-0`, name: t('rules.presets.testCaseName') }],
  }
}

/**
 * 草稿骨架。
 *
 * `updatedTime` 必须是 `null` —— 页面正是靠它区分「还没保存过」与「已保存」，
 * 决定保存时走 create 还是 update。模板与空白规则都是新建，所以一律 `null`。
 * `global` 也一律 `false`：全局规则会自动应用到所有模型，不该由模板悄悄替用户决定。
 */
function createDraft(t: AppTranslator): RequestRewriteRule {
  return {
    id: `rule-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    name: t('rules.untitled'),
    description: '',
    enabled: true,
    global: false,
    protocols: [],
    match: { clientProtocols: [], upstreamProtocols: [] },
    actions: [],
    testCases: [],
    boundProviders: 0,
    updatedTime: null,
  }
}

/** 动作 id 只在界面内区分列表项，取自所属规则，规则被复制时会整体换掉。 */
function toAction(action: RuleActionDraft, ruleId: string, index: number): RuleAction {
  return { ...action, id: `${ruleId}-action-${index}` }
}
