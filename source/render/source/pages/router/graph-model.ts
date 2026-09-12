import { MarkerType, type Edge } from '@xyflow/react'

import { isBuiltInDefaultLogicalModel } from '@common/schemas'
import {
  NODE_KIND_ORDER,
  edgeRunStatusStroke,
  edgeStrokeColor,
  type AppendableKind,
} from './node-meta'
import type { NodeRunStatus } from './node-data'
import {
  DEFAULT_OPERATOR_SET,
  PROMPT_TIMEOUT_DEFAULT,
  SCRIPT_TIMEOUT_DEFAULT,
  type ConditionCase,
  type ConditionOperator,
  type ConditionRule,
  type ControlInputItem,
  type ControlInputKind,
  type NodePosition,
  type RuntimeLogicalModel,
  type SchemaValueType,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowNodeModel,
} from './types'

export const routerStorageKey = 'one-switch.router.graph.v1'

/**
 * 测试运行用的示例原始输入。
 * 保持最小形态：只有路由真正会读到的请求事实（路径 / 方法 / 头 / 体）。
 * `logicalModels` 由页面在运行时注入真实模型列表。
 * `user-agent` 是给「UA 区分来源」用的，`messages` / `tools` 是给两个复杂度预设用的：
 * 不预置这些字段，对应预设跑起来就只能走兜底分支。
 */
export const samplePayload = {
  request: {
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-provider': 'openai',
      'user-agent': 'Cursor/0.42.3 (darwin arm64)',
    },
    body: {
      model: 'gpt-4o-mini',
      tenant: 'vip-cn',
      messages: [{ role: 'user', content: '帮我把这个模块重构成 TypeScript。' }],
      tools: [{ type: 'function', function: { name: 'read_file', description: '读取文件内容' } }],
    },
  },
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
}

export function createConditionRule(): ConditionRule {
  return {
    fieldPath: 'request.body.tenant',
    valueType: 'string',
    operator: 'startsWith',
    valueSource: 'literal',
    valueFieldPath: '',
    value: 'vip-',
  }
}

export function createConditionCase(id: string = createId('case')): ConditionCase {
  return {
    id,
    name: '分支 1',
    logicalOperator: 'and',
    conditions: [createConditionRule()],
  }
}

export function createControlItem(kind: ControlInputKind): ControlInputItem {
  if (kind === 'switch') {
    return {
      id: createId('control'),
      key: 'featureEnabled',
      label: '功能开关',
      kind,
      enabled: true,
      defaultValue: true,
    }
  }

  return {
    id: createId('control'),
    key: 'routeMode',
    label: '路由模式',
    kind,
    enabled: true,
    defaultValue: 'balanced',
    options: [
      { label: 'Balanced', value: 'balanced' },
      { label: 'Fast', value: 'fast' },
      { label: 'Strict', value: 'strict' },
    ],
  }
}

export function createNodeByKind(kind: AppendableKind, position: NodePosition): WorkflowNodeModel {
  const id = createId(kind)

  if (kind === 'control-input') {
    return {
      id,
      kind,
      name: '控制输入节点',
      enabled: true,
      description: '注入开关与下拉等系统控制值。',
      position,
      controls: [createControlItem('switch')],
    }
  }

  if (kind === 'protocol-discovery') {
    return {
      id,
      kind,
      name: '协议发现节点',
      enabled: true,
      description: '输入 request，输出协议分支。',
      position,
    }
  }

  if (kind === 'condition') {
    return {
      id,
      kind,
      name: '条件节点',
      enabled: true,
      description: '按类型感知条件做 IF / ELSE 多分支。',
      position,
      cases: [createConditionCase()],
    }
  }

  if (kind === 'iteration') {
    return {
      id,
      kind,
      name: '遍历迭代节点',
      enabled: true,
      description: '遍历数组 / 对象，逐项执行循环体并汇总结果。',
      position,
      sourcePath: 'logicalModels',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: 'route.modelIds',
      maxIterations: 10,
    }
  }

  if (kind === 'script') {
    return {
      id,
      kind,
      name: 'JS 脚本节点',
      enabled: true,
      description: '在沙箱里跑一段 JS，把结果写回运行数据。',
      position,
      code: '// payload 是本次运行数据的深拷贝，get(路径) 支持 a[*].b 通配投影\nreturn get(\'logicalModels[*].id\') || []',
      resultPath: 'route.scriptResult',
      timeoutMilliseconds: SCRIPT_TIMEOUT_DEFAULT,
    }
  }

  if (kind === 'prompt') {
    return {
      id,
      kind,
      name: 'LLM 节点',
      enabled: true,
      description: '用指定逻辑模型执行提示词，回复写回运行数据。',
      position,
      logicalModelId: '',
      systemPrompt: '',
      promptTemplate: '请从 ${logicalModels[*].id} 里挑一个最适合当前请求的逻辑模型，只回答 id。',
      resultPath: 'route.promptResult',
      temperature: 0.7,
      maxTokens: 1_024,
      timeoutMilliseconds: PROMPT_TIMEOUT_DEFAULT,
    }
  }

  return {
    id,
    kind: 'model-select',
    name: '逻辑模型选择节点',
    enabled: true,
    description: '选择一个或多个逻辑模型，交由出口执行。',
    position,
    source: 'fixed',
    variablePath: '',
    modelIds: [],
    fallbackModelIds: [],
  }
}

const fixedNodeCopy = {
  input: {
    name: '输入请求',
    description: '固定入口节点：接收原始请求并开始路由。',
  },
  output: {
    name: '路由结果出口',
    description: '固定出口节点：输出路由结果并交由代理执行。',
  },
} as const

export function withFixedNodeCopy(nodes: WorkflowNodeModel[]): WorkflowNodeModel[] {
  let changed = false
  const next = nodes.map(node => {
    if (node.kind !== 'input' && node.kind !== 'output') return node
    const fixed = node.kind === 'input' ? fixedNodeCopy.input : fixedNodeCopy.output
    if (node.name === fixed.name && node.description === fixed.description) return node
    changed = true
    return { ...node, name: fixed.name, description: fixed.description }
  })
  return changed ? next : nodes
}

/* ------------------------------------------------------------------------- *
 * 策略预设
 * ------------------------------------------------------------------------- */

/** 固定入口节点（input / output）的名称与描述不可修改。 */
export function createInputNode(position: NodePosition): WorkflowNodeModel {
  return {
    id: 'input',
    kind: 'input',
    name: fixedNodeCopy.input.name,
    enabled: true,
    description: fixedNodeCopy.input.description,
    position,
  }
}

/** 固定出口节点（不受保护的固定节点使用同一份文案）。 */
export function createOutputNode(position: NodePosition): WorkflowNodeModel {
  return {
    id: 'output',
    kind: 'output',
    name: fixedNodeCopy.output.name,
    enabled: true,
    description: fixedNodeCopy.output.description,
    position,
    includeTrace: true,
    summaryLevel: 'detailed',
  }
}

/** 预设生成时的落点来源：预设里每个落点都必须是真实存在的逻辑模型 id。 */
export interface PresetModelPool {
  /** 兜底落点 id；一个已启用逻辑模型都没有时为 `null`。 */
  fallbackModelId: string | null
  /** 可用于分流落点的 id，按当前顺序排列，已排除兜底落点。 */
  landingModelIds: string[]
}

/**
 * 从当前可见的逻辑模型里挑出预设的落点。
 *
 * 预设的意义是「选完就能跑」：写一个不存在的 id，运行结果只会报「没有可用逻辑模型」，
 * 用户还得先去猜该填什么。所以落点一律在生成时按现有逻辑模型定好——
 * 兜底落点取内建默认逻辑模型，分流落点按顺序取兜底之外的其他逻辑模型。
 *
 * 内建默认逻辑模型被停用/删掉时退回第一个已启用模型：
 * 这一条比服务端的回落规则（`resolveLogicalModel`，此时直接回 503）宽松，是故意的——
 * 生成预设是「帮你先把图填上」，前面已经有一个可视可选的真逻辑模型，就没必要留个空落点；
 * 而运行时遇到同样情况则宁可拒绝，也不能替用户猜一个上游。
 */
export function createPresetModelPool(models: RuntimeLogicalModel[]): PresetModelPool {
  const enabledModels = models.filter(model => model.enabled)
  const fallbackModel = enabledModels.find(isBuiltInDefaultLogicalModel) ?? enabledModels[0]
  return {
    fallbackModelId: fallbackModel?.id ?? null,
    landingModelIds: enabledModels.filter(model => model.id !== fallbackModel?.id).map(model => model.id),
  }
}

/**
 * 取落点逻辑模型：`index` 为 `null` 时取兜底落点，否则取第 `index` 个分流落点。
 *
 * 分流候选不够时退回兜底落点——宁可几条分支落到同一个逻辑模型，也不要留下一个死落点；
 * 连兜底都没有（一个已启用逻辑模型都没有）时返回空数组，出口节点会照实报「没有可用逻辑模型」。
 */
export function resolveLandingModelIds(pool: PresetModelPool, index: number | null): string[] {
  const landingModelId = index === null ? pool.fallbackModelId : pool.landingModelIds[index] ?? pool.fallbackModelId
  return landingModelId ? [landingModelId] : []
}

/**
 * 默认策略：请求模型命中逻辑模型 id 就直连它，否则落到默认逻辑模型。
 *
 * 规则全部由基础节点组合而成，没有任何专用节点，
 * 命中判断就是一条普通的「字段 in 字段」条件：
 * 输入 → 条件（route.requestedModel in logicalModels[*].id）
 *        ├─ IF   → 逻辑模型选择（变量取值 route.requestedModel）→ 出口
 *        └─ ELSE → 逻辑模型选择（兜底落点，生成时定好具体 id）→ 出口
 *
 * 注意比较右侧用的是通配投影 `logicalModels[*].id`：
 * 上下文里本来就带着完整的逻辑模型列表，没必要再派生一份 id 数组。
 *
 * 兜底落点在生成时从传入的逻辑模型里挑真实 id，所以这条策略套用即可运行，
 * 不会因为写死了一个不存在的 id 而一上手就报「没有可用逻辑模型」。
 */
export function createDefaultPolicyGraph(models: RuntimeLogicalModel[]): WorkflowGraph {
  const pool = createPresetModelPool(models)
  const conditionCase: ConditionCase = {
    ...createConditionCase('case-1'),
    name: '请求模型在逻辑模型列表里',
    conditions: [
      {
        fieldPath: 'route.requestedModel',
        valueType: 'string',
        operator: 'in',
        valueSource: 'field',
        valueFieldPath: 'logicalModels[*].id',
      },
    ],
  }

  return {
    version: 1,
    nodes: [
      createInputNode({ x: 80, y: 220 }),
      {
        id: 'condition',
        kind: 'condition',
        name: '请求模型是否命中逻辑模型',
        enabled: true,
        description: 'route.requestedModel 在 logicalModels[*].id 里时走直连分支，否则落到默认逻辑模型。',
        position: { x: 460, y: 220 },
        cases: [conditionCase],
      },
      {
        id: 'model-direct',
        kind: 'model-select',
        name: '直连请求模型',
        enabled: true,
        description: '把 route.requestedModel 的取值直接当作逻辑模型 id。',
        position: { x: 860, y: 110 },
        source: 'variable',
        variablePath: 'route.requestedModel',
        modelIds: [],
        fallbackModelIds: [],
      },
      {
        id: 'model-default',
        kind: 'model-select',
        name: '默认逻辑模型',
        enabled: true,
        description: '未命中时落到内置的默认逻辑模型。',
        position: { x: 860, y: 330 },
        source: 'fixed',
        variablePath: '',
        modelIds: resolveLandingModelIds(pool, null),
        fallbackModelIds: [],
      },
      createOutputNode({ x: 1260, y: 220 }),
    ],
    edges: [
      { id: 'edge-input-condition', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'condition' },
      { id: 'edge-condition-direct', sourceNodeId: 'condition', sourcePort: conditionCase.id, targetNodeId: 'model-direct' },
      { id: 'edge-condition-else', sourceNodeId: 'condition', sourcePort: 'else', targetNodeId: 'model-default' },
      { id: 'edge-model-direct-output', sourceNodeId: 'model-direct', sourcePort: 'out', targetNodeId: 'output' },
      { id: 'edge-model-default-output', sourceNodeId: 'model-default', sourcePort: 'out', targetNodeId: 'output' },
    ],
  }
}

/**
 * 空白 / 新建图：没有本地缓存（或缓存损坏）时给用户的起始图。
 *
 * 起点选「协议发现 → 条件 → 逻辑模型选择」，因为协议是路由里最基础的一层事实；
 * 它不是策略预设 —— 菜单里的「逻辑模型命中」才是内建默认策略。
 */
export function createDefaultGraph(): WorkflowGraph {
  // 分支 id 固定，保证同一预设每次生成的图完全一致（否则「当前策略」永远匹配不上）。
  const conditionCase = createConditionCase('case-1')
  const nodes: WorkflowNodeModel[] = [
    createInputNode({ x: 80, y: 220 }),
    {
      id: 'protocol',
      kind: 'protocol-discovery',
      name: '协议发现',
      enabled: true,
      description: '输入 request，输出协议分支。',
      position: { x: 420, y: 220 },
    },
    {
      id: 'condition',
      kind: 'condition',
      name: '条件分支',
      enabled: true,
      description: '按类型感知条件执行 IF / ELSE 多分支。',
      position: { x: 760, y: 220 },
      cases: [conditionCase],
    },
    {
      id: 'model',
      kind: 'model-select',
      name: '逻辑模型选择',
      enabled: true,
      description: '选择一个或多个逻辑模型，交由出口执行。',
      position: { x: 1100, y: 220 },
      source: 'fixed',
      variablePath: '',
      modelIds: [],
      fallbackModelIds: [],
    },
    createOutputNode({ x: 1440, y: 220 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-protocol', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' },
    { id: 'edge-protocol-completions', sourceNodeId: 'protocol', sourcePort: 'openai-completions', targetNodeId: 'condition' },
    { id: 'edge-protocol-responses', sourceNodeId: 'protocol', sourcePort: 'openai-responses', targetNodeId: 'condition' },
    { id: 'edge-protocol-anthropic', sourceNodeId: 'protocol', sourcePort: 'anthropic-messages', targetNodeId: 'condition' },
    { id: 'edge-protocol-unknown', sourceNodeId: 'protocol', sourcePort: 'unknown', targetNodeId: 'model' },
    { id: 'edge-condition-case', sourceNodeId: 'condition', sourcePort: conditionCase.id, targetNodeId: 'model' },
    { id: 'edge-condition-else', sourceNodeId: 'condition', sourcePort: 'else', targetNodeId: 'model' },
    { id: 'edge-model-output', sourceNodeId: 'model', sourcePort: 'out', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

export interface RouterPolicyPreset {
  id: string
  name: string
  description: string
  /** 是否是系统内建的默认策略（列表第一项，可在任何时刻一键选回）。 */
  isDefault: boolean
  /** 生成预设图；落点逻辑模型由传入的当前逻辑模型列表定好，保证套用后即可运行。 */
  createGraph: (models: RuntimeLogicalModel[]) => WorkflowGraph
}

/**
 * UA 分流模板：按客户端来源分流到不同逻辑模型，其余来源回落默认。
 *
 * 「来源」不依赖具体头名：遍历 `request.headers` 逐个看头值，
 * 值里出现哪个客户端标识就走哪个分支 —— 头名大小写、由哪个头携带都不影响判定，
 * 这正是遍历迭代相对「直接取 `request.headers.user-agent`」的价值所在。
 *
 * 两个分支的落点在生成时按传入的逻辑模型列表定好：优先取兜底之外的其他逻辑模型，
 * 所以套用后直接能跑；想按自己的意图分流，把落点改成目标逻辑模型即可。
 *
 * 循环与命中判定靠三条约定咬合：
 * - 循环体末端把落点写进 `route.modelIds`，迭代节点读同一个 `collectPath` 判定本轮命中；
 * - `resultPath` 留空：整轮都没命中时，汇总结果不能用空数组把循环体已写下的值盖掉；
 * - 兜底放在下游一个变量取值的逻辑模型选择节点里，它同时覆盖「命中沿用」与「未命中兜底」。
 */
export function createUserAgentGraph(models: RuntimeLogicalModel[]): WorkflowGraph {
  const pool = createPresetModelPool(models)
  const cursorLanding = resolveLandingModelIds(pool, 0)
  const claudeCliLanding = resolveLandingModelIds(pool, 1)
  const fallbackLanding = resolveLandingModelIds(pool, null)
  const cursorCase: ConditionCase = {
    id: 'case-cursor',
    name: 'Cursor 客户端',
    logicalOperator: 'and',
    conditions: [
      {
        fieldPath: 'route.iteration.item',
        valueType: 'string',
        operator: 'contains',
        valueSource: 'literal',
        value: 'Cursor',
      },
    ],
  }

  const claudeCliCase: ConditionCase = {
    id: 'case-claude-cli',
    name: 'Claude CLI 客户端',
    logicalOperator: 'and',
    conditions: [
      {
        fieldPath: 'route.iteration.item',
        valueType: 'string',
        operator: 'contains',
        valueSource: 'literal',
        value: 'claude-cli',
      },
    ],
  }

  const nodes: WorkflowNodeModel[] = [
    createInputNode({ x: 80, y: 340 }),
    {
      id: 'iteration',
      kind: 'iteration',
      name: '遍历请求头识别来源',
      enabled: true,
      description: '逐个遍历 request.headers 的头值，命中客户端标识时把落点逻辑模型收进 route.modelIds。',
      position: { x: 460, y: 340 },
      sourcePath: 'request.headers',
      collectPath: 'route.modelIds',
      collectMode: 'first',
      resultPath: '',
      maxIterations: 20,
    },
    {
      id: 'ua-condition',
      kind: 'condition',
      name: '头值里的客户端标识',
      enabled: true,
      description: '按头值里出现的客户端标识分流：Cursor / Claude CLI，其余头继续下一轮。',
      position: { x: 880, y: 200 },
      cases: [cursorCase, claudeCliCase],
    },
    {
      id: 'model-cursor',
      kind: 'model-select',
      name: 'Cursor 落点',
      enabled: true,
      description: 'Cursor 客户端落到这个逻辑模型。',
      position: { x: 1280, y: 40 },
      source: 'fixed',
      variablePath: '',
      modelIds: cursorLanding,
      fallbackModelIds: [],
    },
    {
      id: 'model-claude-cli',
      kind: 'model-select',
      name: 'Claude CLI 落点',
      enabled: true,
      description: 'Claude CLI 客户端落到这个逻辑模型。',
      position: { x: 1280, y: 300 },
      source: 'fixed',
      variablePath: '',
      modelIds: claudeCliLanding,
      fallbackModelIds: [],
    },
    {
      id: 'fallback-model',
      kind: 'model-select',
      name: '落点：命中即用，否则兜底',
      enabled: true,
      description: '识别出客户端时沿用迭代收到的落点；整轮都没识别出来才回落到兜底逻辑模型。',
      position: { x: 1280, y: 560 },
      source: 'variable',
      variablePath: 'route.modelIds',
      modelIds: [],
      fallbackModelIds: fallbackLanding,
    },
    createOutputNode({ x: 1680, y: 340 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-iteration', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'iteration' },
    { id: 'edge-iteration-body', sourceNodeId: 'iteration', sourcePort: 'body', targetNodeId: 'ua-condition' },
    { id: 'edge-ua-cursor', sourceNodeId: 'ua-condition', sourcePort: cursorCase.id, targetNodeId: 'model-cursor' },
    { id: 'edge-ua-claude-cli', sourceNodeId: 'ua-condition', sourcePort: claudeCliCase.id, targetNodeId: 'model-claude-cli' },
    // 没识别出客户端也要回到迭代节点：这一条边代表「本轮结束」，不是死循环。
    { id: 'edge-ua-miss-back', sourceNodeId: 'ua-condition', sourcePort: 'else', targetNodeId: 'iteration' },
    { id: 'edge-cursor-back', sourceNodeId: 'model-cursor', sourcePort: 'out', targetNodeId: 'iteration' },
    { id: 'edge-claude-cli-back', sourceNodeId: 'model-claude-cli', sourcePort: 'out', targetNodeId: 'iteration' },
    { id: 'edge-iteration-fallback', sourceNodeId: 'iteration', sourcePort: 'out', targetNodeId: 'fallback-model' },
    { id: 'edge-fallback-output', sourceNodeId: 'fallback-model', sourcePort: 'out', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

/**
 * LLM 复杂度分流模板：让逻辑模型读一遍请求，按复杂度落到不同逻辑模型。
 *
 * 输入 → LLM 节点（判断复杂度，回复写进 route.complexity）
 *        → 条件（route.complexity 匹配正则 [Cc]omplex）
 *          ├─ 复杂 → 逻辑模型选择（固定复杂落点）→ 出口
 *          └─ 其余 → 逻辑模型选择（固定简单落点）→ 出口
 *
 * 判定用「匹配正则」而不是「等于」：LLM 的回复是自由文本，正则不锚定首尾，
 * 天然容忍多余空白，`[Cc]` 又顺手兼容了首字母大写。
 * 想让判定绝对可靠，就把提示词改成「只回答 JSON」，再用脚本节点解析它。
 *
 * LLM 节点默认借用兜底逻辑模型（生成时定好），换成专门的判定用小模型更省；
 * 两个落点也在生成时按传入的逻辑模型列表定好，套用后直接能跑。
 */
export function createLlmComplexityGraph(models: RuntimeLogicalModel[]): WorkflowGraph {
  const pool = createPresetModelPool(models)
  const complexLanding = resolveLandingModelIds(pool, 0)
  const simpleLanding = resolveLandingModelIds(pool, 1)
  const complexCase: ConditionCase = {
    id: 'case-complex',
    name: '复杂请求',
    logicalOperator: 'and',
    conditions: [
      {
        fieldPath: 'route.complexity',
        valueType: 'string',
        operator: 'regex',
        valueSource: 'literal',
        value: '[Cc]omplex',
      },
    ],
  }

  const nodes: WorkflowNodeModel[] = [
    createInputNode({ x: 80, y: 300 }),
    {
      id: 'complexity-prompt',
      kind: 'prompt',
      name: 'LLM 判断请求复杂度',
      enabled: true,
      description: '把请求交给逻辑模型读一遍，只让它回一个词：simple 或 complex。',
      position: { x: 460, y: 300 },
      logicalModelId: pool.fallbackModelId ?? '',
      systemPrompt: '你是模型路由助手：只判断请求复杂度，不回答请求内容，也不做任何解释。',
      promptTemplate: '判断下面这次请求的复杂度，只回答一个词：simple 或 complex。\n\n请求：${request.body}',
      resultPath: 'route.complexity',
      temperature: 0.2,
      maxTokens: 32,
      timeoutMilliseconds: PROMPT_TIMEOUT_DEFAULT,
    },
    {
      id: 'complexity-condition',
      kind: 'condition',
      name: '复杂度判定',
      enabled: true,
      description: 'route.complexity 命中 [Cc]omplex 视为复杂请求；LLM 失败或回答认不出来时走「其余」。',
      position: { x: 880, y: 300 },
      cases: [complexCase],
    },
    {
      id: 'model-complex',
      kind: 'model-select',
      name: '复杂请求落点',
      enabled: true,
      description: '复杂请求落到这个逻辑模型。',
      position: { x: 1300, y: 140 },
      source: 'fixed',
      variablePath: '',
      modelIds: complexLanding,
      fallbackModelIds: [],
    },
    {
      id: 'model-simple',
      kind: 'model-select',
      name: '其余请求落点',
      enabled: true,
      description: '简单请求落到这个逻辑模型。',
      position: { x: 1300, y: 460 },
      source: 'fixed',
      variablePath: '',
      modelIds: simpleLanding,
      fallbackModelIds: [],
    },
    createOutputNode({ x: 1720, y: 300 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-prompt', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'complexity-prompt' },
    { id: 'edge-prompt-condition', sourceNodeId: 'complexity-prompt', sourcePort: 'out', targetNodeId: 'complexity-condition' },
    { id: 'edge-condition-complex', sourceNodeId: 'complexity-condition', sourcePort: complexCase.id, targetNodeId: 'model-complex' },
    { id: 'edge-condition-simple', sourceNodeId: 'complexity-condition', sourcePort: 'else', targetNodeId: 'model-simple' },
    { id: 'edge-complex-output', sourceNodeId: 'model-complex', sourcePort: 'out', targetNodeId: 'output' },
    { id: 'edge-simple-output', sourceNodeId: 'model-simple', sourcePort: 'out', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

/**
 * JS 脚本分流模板：用一段沙箱脚本把请求规模算成分档，再按分档落到不同逻辑模型。
 *
 * 输入 → JS 脚本节点（算消息数 / 上下文字数 / 工具数，返回 simple 或 complex）
 *        → 条件（route.complexity 等于 complex）
 *          ├─ 复杂 → 逻辑模型选择（固定复杂落点）→ 出口
 *          └─ 其余 → 逻辑模型选择（固定简单落点）→ 出口
 *
 * 与 LLM 模板的分流骨架完全一致，差别只在「谁来判定」：
 * 脚本的返回值是确定的字符串，所以这里用「等于」精确判定，不需要正则去容错。
 * `console.log` 会进 trace 的「控制台」，打分过程可以在测试运行面板里直接核对。
 */
export function createScriptRoutingGraph(models: RuntimeLogicalModel[]): WorkflowGraph {
  const pool = createPresetModelPool(models)
  const complexLanding = resolveLandingModelIds(pool, 0)
  const simpleLanding = resolveLandingModelIds(pool, 1)
  const complexCase: ConditionCase = {
    id: 'case-complex',
    name: '复杂请求',
    logicalOperator: 'and',
    conditions: [
      {
        fieldPath: 'route.complexity',
        valueType: 'string',
        operator: 'equals',
        valueSource: 'literal',
        value: 'complex',
      },
    ],
  }

  const nodes: WorkflowNodeModel[] = [
    createInputNode({ x: 80, y: 300 }),
    {
      id: 'complexity-script',
      kind: 'script',
      name: 'JS 计算请求复杂度',
      enabled: true,
      description: '按消息数 / 上下文字数 / 工具数打分，返回 simple 或 complex 写进 route.complexity。',
      position: { x: 460, y: 300 },
      code: `// payload 是本次运行数据的深拷贝；get(路径) 支持 a[*].b 通配投影。
const messages = get('request.body.messages')
const tools = get('request.body.tools')
const messageCount = Array.isArray(messages) ? messages.length : 0
const toolCount = Array.isArray(tools) ? tools.length : 0
// 没有 messages 时退化成整个请求体的长度，至少还有个量级。
const charCount = JSON.stringify(messages ?? get('request.body') ?? '').length

// 三条里任意一条成立就算复杂请求，阈值按自己的业务调。
const isComplex = toolCount > 0 || messageCount > 6 || charCount > 8_000
console.log('复杂度判定', { messageCount, toolCount, charCount, isComplex })

return isComplex ? 'complex' : 'simple'`,
      resultPath: 'route.complexity',
      timeoutMilliseconds: SCRIPT_TIMEOUT_DEFAULT,
    },
    {
      id: 'complexity-condition',
      kind: 'condition',
      name: '复杂度判定',
      enabled: true,
      description: 'route.complexity 等于 complex 视为复杂请求；脚本失败时读不到值，走「其余」。',
      position: { x: 880, y: 300 },
      cases: [complexCase],
    },
    {
      id: 'model-complex',
      kind: 'model-select',
      name: '复杂请求落点',
      enabled: true,
      description: '复杂请求落到这个逻辑模型。',
      position: { x: 1300, y: 140 },
      source: 'fixed',
      variablePath: '',
      modelIds: complexLanding,
      fallbackModelIds: [],
    },
    {
      id: 'model-simple',
      kind: 'model-select',
      name: '其余请求落点',
      enabled: true,
      description: '简单请求落到这个逻辑模型。',
      position: { x: 1300, y: 460 },
      source: 'fixed',
      variablePath: '',
      modelIds: simpleLanding,
      fallbackModelIds: [],
    },
    createOutputNode({ x: 1720, y: 300 }),
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-script', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'complexity-script' },
    { id: 'edge-script-condition', sourceNodeId: 'complexity-script', sourcePort: 'out', targetNodeId: 'complexity-condition' },
    { id: 'edge-condition-complex', sourceNodeId: 'complexity-condition', sourcePort: complexCase.id, targetNodeId: 'model-complex' },
    { id: 'edge-condition-simple', sourceNodeId: 'complexity-condition', sourcePort: 'else', targetNodeId: 'model-simple' },
    { id: 'edge-complex-output', sourceNodeId: 'model-complex', sourcePort: 'out', targetNodeId: 'output' },
    { id: 'edge-simple-output', sourceNodeId: 'model-simple', sourcePort: 'out', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

/** 策略预设：一键把画布换成某种内置规则，随时可切回默认策略。 */
export const ROUTER_POLICY_PRESETS: RouterPolicyPreset[] = [
  {
    id: 'model-direct',
    name: '逻辑模型命中',
    description: '请求模型命中逻辑模型列表就直连它，否则落到默认逻辑模型（条件判定 + 两次逻辑模型选择）。',
    isDefault: true,
    createGraph: createDefaultPolicyGraph,
  },
  {
    id: 'ua-source-routing',
    name: 'UA 区分来源',
    description: '遍历请求头识别客户端（Cursor / Claude CLI），分流到不同逻辑模型，认不出的来源回落默认。',
    isDefault: false,
    createGraph: createUserAgentGraph,
  },
  {
    id: 'llm-complexity-routing',
    name: 'LLM 分析请求复杂度',
    description: '让逻辑模型读一遍请求判断复杂度，复杂请求走高性能落点，其余走快而便宜的落点。',
    isDefault: false,
    createGraph: createLlmComplexityGraph,
  },
  {
    id: 'script-routing',
    name: 'JS 脚本处理请求',
    description: '用沙箱脚本按请求规模打分分档，再按分档分流到不同逻辑模型。',
    isDefault: false,
    createGraph: createScriptRoutingGraph,
  },
]

export function findPolicyPreset(id: string): RouterPolicyPreset | undefined {
  return ROUTER_POLICY_PRESETS.find(preset => preset.id === id)
}

/**
 * 旧数据（或空白数据）里节点坐标会挤在一起，这里按节点类型做一次列式布局。
 * 只有在坐标明显聚集时才生效，避免覆盖用户自己的排版。
 */
export function layoutRouterNodes(nodes: WorkflowNodeModel[]): WorkflowNodeModel[] {
  if (nodes.length <= 1) return nodes

  const positions = nodes.map(node => node.position)
  const minX = Math.min(...positions.map(position => position.x))
  const maxX = Math.max(...positions.map(position => position.x))
  const minY = Math.min(...positions.map(position => position.y))
  const maxY = Math.max(...positions.map(position => position.y))

  const clustered = (maxX - minX) < 180 && (maxY - minY) < 180
  if (!clustered) return nodes

  const nodesByKind = new Map<WorkflowNodeKind, WorkflowNodeModel[]>()
  for (const node of nodes) {
    const list = nodesByKind.get(node.kind) ?? []
    list.push(node)
    nodesByKind.set(node.kind, list)
  }

  const layoutMap = new Map<string, NodePosition>()
  const startX = 80
  const startY = 200
  const columnGap = 340
  const rowGap = 200

  NODE_KIND_ORDER.forEach((kind, column) => {
    const list = nodesByKind.get(kind) ?? []
    list.forEach((node, row) => {
      layoutMap.set(node.id, {
        x: startX + column * columnGap,
        y: startY + row * rowGap,
      })
    })
  })

  return nodes.map(node => ({
    ...node,
    position: layoutMap.get(node.id) ?? node.position,
  }))
}

export function getOperatorsByType(type: SchemaValueType): ConditionOperator[] {
  return DEFAULT_OPERATOR_SET[type]
}

export type WorkflowEdgeData = {
  /** 端口语义，用于自定义连线着色 */
  sourceKind: WorkflowNodeKind
  sourcePort: string
  /** 空闲态连线基础色 */
  stroke: string
  /** 上游 / 下游节点的运行状态，用于渐变与状态着色 */
  sourceRunStatus: NodeRunStatus
  targetRunStatus: NodeRunStatus
  /** 连线任意一端是当前悬浮的节点（对应 Dify 的 `_connectedNodeIsHovering`） */
  highlighted: boolean
  /** 任意一端节点被禁用时整条线降透明度（对应 Dify 的 `_dimmed`） */
  dimmed: boolean
  /** 是否允许在连线上插入节点 */
  canInsert: boolean
  /** 在连线上插入节点（把新节点接到这条连线的中间） */
  onInsert?: (edgeId: string, kind: AppendableKind) => void
}

export type WorkflowFlowEdge = Edge<WorkflowEdgeData>

export type BuildFlowEdgesOptions = {
  onInsert?: (edgeId: string, kind: AppendableKind) => void
  /** 节点运行状态，用于连线渐变 */
  runStatusByNode?: Map<string, NodeRunStatus>
  /** 当前悬浮的节点 id */
  hoveredNodeId?: string | null
}

/**
 * 图数据 → React Flow 边。
 * 端口用显式 id 传递，避免依赖 handle 挂载顺序。
 */
export function buildFlowEdges(graph: WorkflowGraph, options: BuildFlowEdgesOptions = {}): WorkflowFlowEdge[] {
  const kindById = new Map(graph.nodes.map(node => [node.id, node.kind]))
  const enabledById = new Map(graph.nodes.map(node => [node.id, node.enabled]))
  const runStatusByNode = options.runStatusByNode
  const hoveredNodeId = options.hoveredNodeId ?? null

  return graph.edges.map(edge => {
    const sourceKind = kindById.get(edge.sourceNodeId) ?? 'input'
    const stroke = edgeStrokeColor(sourceKind, edge.sourcePort)
    const sourceRunStatus = runStatusByNode?.get(edge.sourceNodeId) ?? 'idle'
    const targetRunStatus = runStatusByNode?.get(edge.targetNodeId) ?? 'idle'
    // 箭头画在终点，所以跟随下游状态色；没有运行过时回落到分支色。
    const markerColor = edgeRunStatusStroke(targetRunStatus) ?? stroke

    return {
      id: edge.id,
      type: 'workflow',
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePort,
      target: edge.targetNodeId,
      targetHandle: 'target',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: markerColor,
      },
      data: {
        sourceKind,
        sourcePort: edge.sourcePort,
        stroke,
        sourceRunStatus,
        targetRunStatus,
        highlighted: hoveredNodeId !== null
          && (edge.sourceNodeId === hoveredNodeId || edge.targetNodeId === hoveredNodeId),
        dimmed: !(enabledById.get(edge.sourceNodeId) ?? true) || !(enabledById.get(edge.targetNodeId) ?? true),
        canInsert: sourceKind !== 'output',
        onInsert: options.onInsert,
      },
    }
  })
}
