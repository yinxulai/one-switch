import type { Protocol } from '@common/schemas'

export type WorkflowNodeKind =
  | 'input'
  | 'control-input'
  | 'protocol-discovery'
  | 'condition'
  | 'model-select'
  | 'iteration'
  | 'output'

export type WorkflowProtocol = Protocol | 'unknown'

export type WorkflowTransport = 'http' | 'http-sse'

/**
 * 字段类型。
 * `object` 用于「要判断对象内容」的场景（取键、判空、结构化比较）；
 * `unknown` 表示 schema 里推不出类型（数组元素、未定义字段、动态脚本产出），
 * 此时不限制操作符，语义完全交给运行时按实际取值决定 —— 也就是「按动态脚本那样处理」。
 */
export type SchemaValueType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object' | 'unknown'

/**
 * 通配投影后缀：`logicalModels[*].id` 表示「先把 `logicalModels` 展开成元素集合，
 * 再对每个元素取 `id`，最后拍平成一个数组」。
 * 引擎的路径解析器和字段候选列表共用这个后缀，避免两边写法漂移。
 */
export const PATH_WILDCARD_SUFFIX = '[*]'

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'in'
  | 'notIn'
  | 'regex'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'isTrue'
  | 'isFalse'
  | 'empty'
  | 'notEmpty'
  | 'exists'

export interface NodePosition {
  x: number
  y: number
}

export interface WorkflowNodeBase {
  id: string
  kind: WorkflowNodeKind
  name: string
  enabled: boolean
  description: string
  position: NodePosition
}

export type WorkflowSourcePort =
  | 'out'
  | 'body'
  | 'else'
  | WorkflowProtocol
  | (string & {})

export interface WorkflowEdge {
  id: string
  sourceNodeId: string
  sourcePort: WorkflowSourcePort
  targetNodeId: string
}

export interface WorkflowGraph {
  version: 1
  nodes: WorkflowNodeModel[]
  edges: WorkflowEdge[]
}

/** 一次运行里可见的逻辑模型（运行时不缓存模型配置，只有 id / 名称 / 开关）。 */
export interface LogicalModelContext {
  id: string
  name: string
  enabled: boolean
}

/**
 * 归一化之后的原始请求。
 * 保持最小的请求形状：`headers` 是扁平的字符串字典，没有多值头一说
 * （同名头在代理入口处已按 `,` 合并）。
 */
export interface WorkflowRequestPayload {
  path?: string
  method?: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
  [key: string]: unknown
}

export interface RouteContext {
  request: WorkflowRequestPayload
  logicalModels: LogicalModelContext[]
  metadata: Record<string, unknown>
  traceId: string
}

export interface RouteContextInput {
  request: WorkflowRequestPayload
  /** 本次运行可见的逻辑模型；缺省时按内置默认逻辑模型处理 */
  logicalModels?: LogicalModelContext[]
  metadata?: Record<string, unknown>
}

export interface RouteContextEnvelope {
  payload: Record<string, unknown>
  context: RouteContext
}

export interface InputNode extends WorkflowNodeBase {
  kind: 'input'
}

export type ControlInputKind = 'switch' | 'select'

export interface ControlInputOption {
  label: string
  value: string
}

export interface ControlInputItem {
  id: string
  key: string
  label: string
  kind: ControlInputKind
  enabled: boolean
  defaultValue: string | boolean
  options?: ControlInputOption[]
}

export interface ControlInputNode extends WorkflowNodeBase {
  kind: 'control-input'
  controls: ControlInputItem[]
}

export interface ProtocolDiscoveryNode extends WorkflowNodeBase {
  kind: 'protocol-discovery'
}

export type ConditionValueSource = 'literal' | 'field'

export interface ConditionRule {
  fieldPath: string
  valueType: SchemaValueType
  operator: ConditionOperator
  /** 比较值来源：`literal`（默认）用 `value` / `enumOptions`，`field` 读取 `valueFieldPath` 的实时取值 */
  valueSource?: ConditionValueSource
  /** `field` 来源的比较字段路径，例如 `logicalModels[*].id` */
  valueFieldPath?: string
  value?: string
  secondaryValue?: string
  enumOptions?: string[]
}

export type ConditionLogicalOperator = 'and' | 'or'

export interface ConditionCase {
  id: string
  name: string
  logicalOperator: ConditionLogicalOperator
  conditions: ConditionRule[]
}

export interface ConditionNode extends WorkflowNodeBase {
  kind: 'condition'
  cases: ConditionCase[]
}

/**
 * 逻辑模型选择节点的落点来源。
 * - `fixed`：使用配置好的固定逻辑模型列表；
 * - `variable`：把某个字段的取值直接当作逻辑模型 id（例如 `route.requestedModel`），
 *   取不到值时使用兜底逻辑模型。
 *
 * 这里刻意不内置「跟随请求模型」这类专用语义：请求模型直连由
 * 「条件（`route.requestedModel in logicalModels[*].id`） + 逻辑模型选择(变量) +
 * 逻辑模型选择(固定 default)」等基础节点组合表达。
 */
export type ModelSelectSource = 'fixed' | 'variable'

export interface ModelSelectNode extends WorkflowNodeBase {
  kind: 'model-select'
  source: ModelSelectSource
  /** `variable` 来源读取的字段路径，例如 `route.requestedModel` */
  variablePath: string
  /** 固定逻辑模型（`fixed` 来源使用） */
  modelIds: string[]
  /** 兜底逻辑模型（`variable` 取不到值时使用；为空表示不兜底） */
  fallbackModelIds: string[]
}

/** 运行时可见的逻辑模型（与主进程逻辑模型列表同形）。 */
export interface RuntimeLogicalModel {
  id: string
  name: string
  enabled: boolean
}

export interface ModelSelection {
  modelIds: string[]
  /** 是否由节点上的显式取值命中（变量取不到值而回落到兜底逻辑模型时为 `false`） */
  matched: boolean
  reason: string
}

/** 内置默认逻辑模型：默认策略里「未命中」分支的落点。 */
export const DEFAULT_MODEL_IDS: string[] = ['default']

/**
 * 迭代结果的汇总方式。
 * - `first`：首个非空的每轮结果即停止（「在数组里找第一个满足条件的元素」）；
 * - `last`：保留最后一次非空结果；
 * - `list`：收集全部非空结果；
 * - `count`：不做汇总，写回实际执行轮数。
 */
export type IterationCollectMode = 'first' | 'last' | 'list' | 'count'

/** 迭代作用域里对下游可见的固定字段（相对 `route.iteration`）。 */
export const ITERATION_SCOPE_FIELDS = ['item', 'index', 'key', 'total'] as const

/**
 * 遍历迭代节点。
 *
 * 控制流由边表达：`body` 是循环体入口，循环体最后一个节点用一条回边指回本节点
 * 表示「本轮结束」，`out` 是循环结束后继续往下走的出口。
 * 因此本节点只能手工拼出，不做隐式子图。
 */
export interface IterationNode extends WorkflowNodeBase {
  kind: 'iteration'
  /** 要遍历的字段路径；支持通配投影（`logicalModels[*].id`）。取到数组按元素遍历，取到对象按键值对遍历。 */
  sourcePath: string
  /** 每轮结束后从该路径读取本轮结果；读到空值（undefined / null / 空数组 / 空字符串）视为未命中 */
  collectPath: string
  /** 汇总方式 */
  collectMode: IterationCollectMode
  /** 汇总结果写回的字段路径；`count` 模式写入轮数 */
  resultPath: string
  /** 轮数上限（业务预算），与全局步骤预算相互独立 */
  maxIterations: number
}

export interface OutputNode extends WorkflowNodeBase {
  kind: 'output'
  includeTrace: boolean
  summaryLevel: 'brief' | 'detailed'
}

export type WorkflowNodeModel =
  | InputNode
  | ControlInputNode
  | ProtocolDiscoveryNode
  | ConditionNode
  | ModelSelectNode
  | IterationNode
  | OutputNode

/**
 * 引擎写入 payload 的 `route` 命名空间：路由决策 + 决策依据。
 *
 * 设计约定（见 `product/route-design.md`）：
 * - `metadata` 里的内容归调用方所有，引擎只读不写；
 * - 决策结果（`modelIds`）与决策依据（请求模型、协议、控制输入、迭代作用域）都放在 `route` 下；
 * - 过程性的调试数据（协议归一化结果、每个节点的判定明细）只进 trace，不进 payload；
 * - 不再写「可用逻辑模型 id」这类派生冗余字段：`logicalModels` 已经在上下文里，
 *   需要时用通配投影取值（`logicalModels[*].id`）即可。
 */
export interface RouteDecision {
  /** 本次运行的追踪 id */
  traceId: string
  /** 识别到的请求协议；未识别时为 `unknown` */
  protocol: WorkflowProtocol
  /** 传输方式，来自请求头 / `request.body.stream` */
  transport: WorkflowTransport
  /** 最终落点逻辑模型；既没有命中也没有兜底时为空数组 */
  modelIds: string[]
  /** 是否走了兜底策略（变量取值没有命中，转而使用兜底逻辑模型） */
  fallback: boolean
  /** 请求体里的模型 id（`request.body.model`） */
  requestedModel: string
  /** 控制输入节点注入的运行时取值 */
  controls: Record<string, unknown>
  /** 迭代作用域；从未进入过遍历迭代节点时不存在 */
  iteration?: RouteIterationScope
}

/**
 * 迭代作用域：遍历迭代节点在每一轮开始时写入的运行时取值。
 *
 * 只在循环体内可见（循环体节点通过回边仍算迭代节点的下游，
 * 因此字段推导会把 `route.iteration.*` 暴露给循环体内的条件节点）。
 * 退出循环后由迭代节点写回最终汇总结果，作用域字段保留最后一轮的投影。
 */
export interface RouteIterationScope {
  /** 当前轮的来源路径 */
  source: string
  /** 当前轮的元素（数组模式）或取值（对象模式） */
  item: unknown
  /** 数组下标；对象模式为键在 `Object.keys` 里的序号 */
  index: number
  /** 对象模式下当前键；数组模式为空字符串 */
  key: string
  /** 本轮来源的总条数 */
  total: number
}

export interface WorkflowTrace {
  nodeId: string
  nodeName: string
  kind: WorkflowNodeKind
  success: boolean
  message: string
  details?: Record<string, unknown>
}

export interface WorkflowRunResult {
  outputPayload: unknown
  protocol: WorkflowProtocol
  /** 决策结果，按产出它的节点 id 组织 */
  nodeOutputs: NodeOutputMap
  stopReason: 'output' | 'missing-next' | 'max-steps' | 'error'
  trace: WorkflowTrace[]
}

/**
 * 单个节点产出的一条输出数据。
 * 渲染时不展示 `nodeId`，而是查节点名称作为分组标题，因此这里的 `name`
 * 只负责「一条输出叫什么」——例如控制项标签、条件分支名、逻辑模型 id。
 */
export interface NodeOutput {
  name: string
  value: unknown
  /** 可选补充说明，例如「兜底」「未命中」 */
  note?: string
}

/** 节点 id → 该节点产出的输出列表（同一节点可以产出多条）。 */
export type NodeOutputMap = Record<string, NodeOutput[]>

export interface SchemaFieldDescriptor {
  path: string
  valueType: SchemaValueType
  sourceNodeId: string
  sourcePort: string
  enumOptions?: string[]
  /** 一句话说明这个字段是什么，用于面板里的候选列表补充解释。 */
  note?: string
}

export interface ConfigHints {
  fields: SchemaFieldDescriptor[]
  recommendedOperators: Record<SchemaValueType, ConditionOperator[]>
}

/** 全部操作符，顺序即面板里的展示顺序。 */
export const ALL_CONDITION_OPERATORS: ConditionOperator[] = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'in',
  'notIn',
  'regex',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'isTrue',
  'isFalse',
  'empty',
  'notEmpty',
  'exists',
]

export const DEFAULT_OPERATOR_SET: Record<SchemaValueType, ConditionOperator[]> = {
  string: ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn', 'regex', 'empty', 'notEmpty', 'exists'],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'exists'],
  boolean: ['isTrue', 'isFalse', 'equals', 'notEquals', 'exists'],
  enum: ['equals', 'notEquals', 'in', 'notIn', 'exists'],
  array: ['contains', 'notContains', 'empty', 'notEmpty', 'exists'],
  object: ['contains', 'notContains', 'equals', 'notEquals', 'empty', 'notEmpty', 'exists'],
  // 类型未知时不收窄操作符：判定语义交给运行时，与动态脚本的处理方式一致。
  unknown: [...ALL_CONDITION_OPERATORS],
}

/**
 * 支持「比较值来自另一个字段」的操作符。
 * 例如 `route.requestedModel in logicalModels[*].id` —— 通用的成员判定，
 * 不需要引擎为某个具体场景预先算好布尔结果。
 */
export const FIELD_OPERAND_OPERATORS: ConditionOperator[] = ['equals', 'notEquals', 'in', 'notIn', 'contains', 'notContains']
