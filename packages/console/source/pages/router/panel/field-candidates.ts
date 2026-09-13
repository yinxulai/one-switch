import type { SchemaFieldDescriptor, SchemaValueType } from '@common/router/types'

/**
 * 各节点面板**读到**的字段候选表口径。
 *
 * 节点能引用什么路径，取决于它自己面板里列了什么：条件节点是字段下拉、脚本节点是
 * `get()` 的补全、LLM 节点是 `${}` 的补全。列什么属于界面行为，但有一条硬约束 ——
 * **图里引用的每条路径都必须出现在引用它的那个节点的候选表里**：
 * 预设里写了 `get('request.body.messages')`，用户的脚本编辑器却补全不出来，
 * 这张图就是「能跑但改不动」。所以这套口径同时被面板和回归用例使用
 * （`pages/router/field-hints.test.ts` 里的「内置策略 × 字段候选表」），
 * 面板换了过滤条件、预设写了候选表之外的路径，都会当场红掉。
 *
 * 收窄的唯一理由是「这个类型的值在这里没有意义」，不是「看起来更整齐」：
 * 逻辑模型选择要的是能当 id 用的标量或列表，遍历迭代要的是能逐个走的东西。
 * 其余节点一律给全部上游字段 —— 条件节点按字段类型给操作符而不是过滤字段；
 * 脚本的 `get()` 读得动整体对象，提示词的 `${}` 对非标量做 JSON 序列化，
 * 把 `request.body` 这种整体字段藏起来，只会让人写得出、点不出。
 */
export type FieldReadKind = 'condition' | 'model-select' | 'iteration' | 'script' | 'prompt'

/** 会「读字段」的节点类型；其余节点（输入、协议发现、控制项、出口……）不引用任何路径。 */
export const FIELD_READ_KINDS: readonly FieldReadKind[] = ['condition', 'model-select', 'iteration', 'script', 'prompt']

const TYPE_FILTERS: Partial<Record<FieldReadKind, SchemaValueType[]>> = {
  'model-select': ['string', 'array'],
  iteration: ['array', 'object'],
}

/** 按节点类型收窄上游字段，得到该节点面板真正会列出来的候选表。 */
export function readCandidates(kind: FieldReadKind, fields: SchemaFieldDescriptor[]): SchemaFieldDescriptor[] {
  const accepted = TYPE_FILTERS[kind]
  return accepted ? fields.filter(field => accepted.includes(field.valueType)) : fields
}
