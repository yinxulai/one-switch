# 路由工作台设计文档

## 1. 背景与目标

One Switch 既是本地代理，也是一套请求路由与模型选择系统。为了让路由逻辑从“隐式条件分支”升级为“可视化、可调试、可复用”的执行图，设计了“路由工作台”：以节点图的方式描述一条请求如何被识别、过滤、判定，并最终落到某个逻辑模型。

路由工作台解决的核心问题包括：

- 让请求通路不再依赖代码分支散落各处；
- 让条件判断、逻辑模型选择和最终输出逻辑可视化；
- 让非开发人员也能理解一条请求如何被选到目标模型；
- 让调试更容易，因为每个节点都能留下 trace。

路由不是“编排内容修改”，而是“根据请求选择最终要求的逻辑模型”。它强调：

- 入口统一；
- 选择决策可审计；
- 每个节点只做一件事；
- 不在路由层改写请求内容。

---

## 2. 核心设计原则

### 2.1 核心目标：选择目标模型

整个工作流的最终结果不是修改 payload，而是：

- 识别请求属于什么协议；
- 判断是否允许继续；
- 在满足条件时选中某个逻辑模型；
- 将请求交给对应逻辑模型或 provider chain。

因此，路由工作台的核心价值是：

- 根据请求决定去哪里；
- 而不是根据请求改什么。

### 2.2 节点单一职责

每个 node 只负责一种明确动作：识别、判断、选择、输出，不混合多个职责。

### 2.3 请求上下文统一

路由执行前，所有输入都被标准化为统一上下文对象，例如：

```ts
{
  request: {
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { 'content-type': 'application/json' } satisfies Record<string, string>,
    body: { model: 'gpt-4o-mini' }
  },
  metadata: {
    client: 'cursor',
    tenant: 'acme'
  }
}
```

`request` 只保留归一化之后的最小形状：`method` / `path` / `headers` / `body`。`headers` 是**扁平的字符串字典**（`Record<string, string>`）——代理入口已经把同名头按 `,` 合并，路由侧不需要多值头，因此也不再为它展开字段路径。

后续节点统一对该对象读取或写入，而不是去猜测 API 差异。

### 2.4 最小默认路径

路由图不要求所有节点都出现在同一张图里。默认最小链路是：

Input -> ModelSelect -> Output

复杂链路通过条件和策略分支扩展。

### 2.5 全局配置体验优先

不仅 Condition，任何“可输入、可配置”的节点都应提供类型感知与上下文感知体验：

- 配置项来自上游端口 schema，而不是自由文本猜字段；
- 操作符、候选值、输入控件应随字段类型自动切换；
- 操作符必须同时给出中文名称与一句话语义说明（`equals` 这类标识符只作为次要信息），因为用户读到的说明就是他对判定行为的唯一预期；
- 配置保存前必须做类型校验与可执行性校验；
- schema 变化后需要给出迁移提示，避免静默失效。

### 2.6 输出契约：`route` 命名空间

路由执行器不修改调用方的 `metadata`（`metadata` 归调用方所有，引擎只读），所有由路由自身产生的数据都写在 payload 顶层的 `route` 对象里：

```ts
interface RouteDecision {
  traceId: string                      // 本次运行的追踪 id
  protocol: WorkflowProtocol           // 识别到的请求协议，未识别为 unknown
  transport: WorkflowTransport         // http | http-sse
  modelIds: string[]                   // 最终落点逻辑模型（决策结果）
  fallback: boolean                    // 是否走了兜底策略
  requestedModel: string               // request.body.model
  controls: Record<string, unknown>    // 控制输入节点注入的运行时取值
  iteration?: RouteIterationScope      // 遍历迭代节点写下的「当前轮」作用域
}
```

约定：

- **决策结果**（`modelIds`）与**决策依据**（`protocol` / `transport` / `requestedModel` / `controls` …）都放在 `route` 下，条件节点可直接按 `route.*` 选字段；
- **可推导的数据不落库**：像「本次可见的逻辑模型 id 列表」这种由 `logicalModels` 直接推出来的数组不再单独写进 `route`，需要时用通配投影 `logicalModels[*].id` 现算（见 §2.8）；
- **过程性数据**只进 trace，不进 payload —— 例如协议归一化后的请求体（`{protocol, transport, model, messages}`）与每个节点的判定明细，避免 payload 里出现只有调试才看的字段；
- **引擎不预计算业务判定**：像「请求模型是否命中逻辑模型列表」这种结论由条件节点在图上现场算出，引擎只提供原始字段（`requestedModel` / `logicalModels`）；
- **运行结果按节点组织**：`runWorkflow` 返回的 `nodeOutputs` 是 `Record<节点 id, NodeOutput[]>`，每个节点可以登记多条输出（控制项、条件分支、落点…），渲染时再查节点名称作为分组标题，因此「谁产出了什么」看得见；
- 旧版本图（没有 `route`）在运行时会被补齐，调用方无需迁移；重命名前的 payload 键（`queues`、`route.queueIds`）读取时兼容一次后丢弃。

### 2.7 默认策略：模型直达

系统内建一条默认策略，任何时刻都可通过页头的「策略」下拉一键选回：

> 请求里的 `model` 命中我们的逻辑模型 id 时，请求该逻辑模型；否则请求默认逻辑模型（`default`）。

这条策略**不引入任何专用节点**，完全用基础节点拼出来，命中判断就是一条普通的「字段 in 字段」条件：

```text
Input ─▶ Condition（route.requestedModel in logicalModels[*].id）
           ├─ IF   ─▶ ModelSelect（取值来源 = 变量 route.requestedModel）─▶ Output
           └─ ELSE ─▶ ModelSelect（取值来源 = 固定逻辑模型 default）───▶ Output
```

两个基础节点各自提供一种通用能力：

条件节点的**比较值来源**：

| 比较值来源 | 语义 |
| --- | --- |
| `literal`（默认） | 与规则里写的固定值比较，`in` / `notIn` 按逗号拆成列表 |
| `field` | 与另一个字段的实时取值比较，例如 `route.requestedModel in logicalModels[*].id`；`in` / `notIn` 取到数组时按成员判定，取到单值时直接比较，取不到值时按空集合处理 |

`model-select` 节点的**取值来源**：

| 取值来源 | 语义 |
| --- | --- |
| `fixed` | 与请求无关，始终使用节点上勾选的逻辑模型列表 |
| `variable` | 读取 `variablePath` 指向字段的取值作为落点：字符串视为单个逻辑模型 id，字符串数组视为逻辑模型 id 列表；取不到值时使用节点上的兜底逻辑模型，兜底列表为空则不产出落点 |

这样做的好处：

- **不枚举模型**：命中判断基于本次运行真正可见的逻辑模型集合（用通配投影 `logicalModels[*].id` 现算），逻辑模型增减时规则自动生效，不需要改图；
- **没有专用节点，也没有预计算字段**：模型直达只是「条件 + 两次逻辑模型选择」的一种拼法，按协议、按租户、按控制输入等策略用同一组基础节点同样能表达。

旧图里用过的 `mode: 'follow-request-model'` 会在读取时迁移为「`source: 'variable'` + `variablePath: 'route.requestedModel'`」，行为不变；旧的 `queue-select` 节点同样会在解析时迁移成 `model-select`。

预设策略放在 `graph-model.ts` 的 `ROUTER_POLICY_PRESETS` 中，第一个即默认策略。四个预设都只由基础节点拼成（没有专用节点），UI 侧由 `components/policy-menu.tsx` 呈现：

| 预设 id | 名称 | 拼法 |
| --- | --- | --- |
| `model-direct` | 逻辑模型命中 | 条件（`route.requestedModel in logicalModels[*].id`）+ 两次逻辑模型选择 |
| `ua-source-routing` | UA 区分来源 | 遍历 `request.headers` 的头值识别客户端（Cursor / Claude CLI），分流到不同逻辑模型；认不出来回落兜底逻辑模型 |
| `llm-complexity-routing` | LLM 分析请求复杂度 | LLM 节点判断请求复杂度写进 `route.complexity` + 条件（正则 `[Cc]omplex`）+ 两个固定落点 |
| `script-routing` | JS 脚本处理请求 | JS 脚本节点按消息数 / 上下文字数 / 工具数算复杂度写进 `route.complexity` + 条件（等于 `complex`）+ 两个固定落点 |

四个预设覆盖四种「判定依据」：请求模型（读上下文）→ 请求头（循环遍历）→ LLM（自然语言判定）→ JS 脚本（确定性计算）。同类型的拼法只留一个，需要变体时在画布上改比多一个菜单项更好用。

`ua-source-routing` 用一套「循环体写落点、迭代节点只判定命中」的拼法：

- **循环体负责产出**：循环体末端的 `model-select`（固定值或取 `route.iteration.item.id`）把落点写进 `route.modelIds`，这就是唯一的结果载体；
- **命中判定复用同一路径**：迭代节点的 `collectPath` 直接填 `route.modelIds`，每轮结束读一次，非空即「本轮命中」；`collectMode: 'first'` 表示命中即停止遍历；
- **`resultPath` 留空**：`resultPath` 是「整轮汇总结果」的写回位置。如果把汇总结果本身当作落点，就填 `route.modelIds`；而这个预设要区分「命中」和「没命中」，若同样填 `route.modelIds`，整轮没命中时会用空数组把循环体已经写下的落点覆盖掉，因此留空，让 `route.modelIds` 保持迭代结束时的状态；
- **兜底交给下游**：循环体下游再接一个 `source: 'variable'`、`variablePath: 'route.modelIds'` 的逻辑模型选择节点，命中时它读到循环体写的 id（`matched: true`、不标记回落），没命中时读到空值、走自己的 `fallbackModelIds`（`matched: false`、`route.fallback = true`）。一个节点同时覆盖「命中沿用」和「未命中兜底」，不需要额外条件分支。

它之所以遍历 `request.headers` 而不是直接取 `request.headers.user-agent`：**判定的是头值里出现的客户端标识，不是某个固定头名**。头名大小写、由哪个头携带（`user-agent` / `x-client-name` / 自定义头）都不影响结果，客户端改名或换头也不用改图；代价是兜底分支要负责「一个都没认出来」。

两个复杂度预设的骨架完全一致（判定 → 条件 → 两个固定落点），差别只在「谁来判定」：

- **LLM 节点**：提示词只要求回答一个词，回复自由度高，所以条件用不锚定首尾的**正则匹配** `[Cc]omplex`，兼顾多余空白与首字母大写；代价是每次路由都会多一次模型调用，且判定结果不可完全预期。
- **JS 脚本节点**：返回值是确定的字符串，所以条件用**等于**精确判定；`console.log` 会进 trace 的「控制台」，打分过程可以在测试运行面板里核对；代价是规则要自己维护。

两者的判定结果都写在 `route.complexity`。LLM / 脚本节点失败时该字段读不到值，条件自然走「其余」（简单）分支，判定失败倾向于走便宜模型。想让判定绝对可靠，可以把 LLM 提示词改成「只回答 JSON」，再用脚本节点解析它。

预设里的落点 id（`high-effort` / `fast-cheap` / `cursor` / `claude-cli`）都是占位值，换成自己的逻辑模型即可。

循环体用**回边**闭合：从迭代节点的 `body` 端口连出去，末端连回迭代节点自身即代表「本轮结束」，不是死循环。

### 2.8 路径取值与通配投影

条件节点、逻辑模型选择节点、遍历迭代节点都靠同一套「路径取值」读数据，语法只有两条：

| 语法 | 语义 |
| --- | --- |
| `a.b.c` | 逐层取字段，任一层取不到就是 `undefined` |
| `a[*].b` | **通配投影**：把 `a` 当集合展开，对每个元素取 `b`，最后拍平成一个数组 |

通配投影让数组 / 对象的「内容判断」不需要新节点类型：

- `logicalModels[*].id` → 本次可见逻辑模型的 id 数组（默认策略的 `in` 判定就用它）；
- `request.body.items[*].type` → 每个元素的 `type` 组成的数组，可直接用 `contains` / `notIn` 判定；
- 投影目标是对象、整个对象本身就是数组时按需继续递归，深度上限由字段候选表的展开策略控制（`MAX_FLATTEN_DEPTH = 4`）。

字段候选表（`field-hints.ts`）与引擎（`engine.ts`）共用这条约定：候选表对数组字段同时给出「整体数组」和「`path[*].key` 投影」两类候选，用户选到的路径一定能在运行时取到值。

### 2.9 类型系统与运行时语义

字段类型由路径取值推断，共 7 类：

| 类型 | 来源 | 可用操作符 |
| --- | --- | --- |
| `string` / `number` / `boolean` / `enum` | 示例数据推断、控制项定义、协议枚举 | 对应类型的子集 |
| `array` | 数组整体字段 | `contains` / `notContains` / `empty` / `notEmpty` / `exists` / `equals` / `notEquals` |
| `object` | 对象整体字段（`request.headers`、采样到的嵌套对象） | `contains`（按键名） / `empty` / `notEmpty` / `exists` / `equals` / `notEquals` |
| `unknown` | 推不出类型：数组元素、未定义字段、动态脚本产出 | **不限制**，全部操作符可选，语义完全交给运行时按实际取值决定 |

运行时语义按**实际取值**判定，不按静态类型：

- `empty` / `notEmpty`：`undefined` / `null` 为空；数组看 `length`；对象看有没有键；字符串看去掉空白后是否为空；
- `contains`：数组比较每个元素（对象元素按结构化序列化比较，便于按内容筛选）；对象比较键名；其余退化成子串包含；
- `equals` / `notEquals`：对象 / 数组先按结构化序列化比较，再退化成字符串比较。

这条「`unknown` 不限制操作符 + 运行时按实际取值决定」的设计，等价于把条件判断当成动态脚本处理：类型只是给 UI 的提示，不是运行时约束。

#### 2.9.1 操作符清单（中文名 / 语义）

面板与节点卡片展示的是下表的中文名，标识符只作为次要信息（`CONDITION_OPERATOR_META`，`source/render/source/pages/router/types.ts`）。说明文字与引擎判定一一对应：用户读到什么，运行时就得怎么判：

| 标识符 | 中文名 | 语义 | 备注 |
| --- | --- | --- | --- |
| `equals` | 等于 | 对象 / 数组先按结构化内容比较，再退化成字符串比较 | 支持比较值来自字段 |
| `notEquals` | 不等于 | 与「等于」相反 | 支持比较值来自字段 |
| `contains` | 包含 | 数组比元素、对象比键名，其余比子串 | 支持比较值来自字段 |
| `notContains` | 不包含 | 与「包含」相反 | 支持比较值来自字段 |
| `startsWith` | 以…开头 | 字符串取值以比较值开头 | |
| `endsWith` | 以…结尾 | 字符串取值以比较值结尾 | |
| `in` | 属于 | 取值是集合中的一员；集合可以来自另一个字段 | 支持比较值来自字段 |
| `notIn` | 不属于 | 取值不在集合中 | 支持比较值来自字段 |
| `regex` | 匹配正则 | 用正则表达式匹配字符串，正则非法时判为不命中 | |
| `gt` | 大于 | 数值比较：取值 > 比较值 | |
| `gte` | 大于等于 | 数值比较：取值 ≥ 比较值 | |
| `lt` | 小于 | 数值比较：取值 < 比较值 | |
| `lte` | 小于等于 | 数值比较：取值 ≤ 比较值 | |
| `between` | 介于 | 数值落在「下限 ≤ 取值 ≤ 上限」闭区间内 | 需要上下限两个值 |
| `isTrue` | 为真 | 取值严格等于 `true` | 不需要比较值 |
| `isFalse` | 为假 | 取值严格等于 `false` | 不需要比较值 |
| `empty` | 为空 | 对象看键数、数组看长度、字符串去空白后为空 | 不需要比较值 |
| `notEmpty` | 不为空 | 与「为空」相反 | 不需要比较值 |
| `exists` | 存在 | 取值不是 `undefined` / `null` | 不需要比较值 |

末尾五个「一元判定」（`isTrue` / `isFalse` / `empty` / `notEmpty` / `exists`）不展示比较值输入框；`FIELD_OPERAND_OPERATORS` 里的操作符额外提供「比较值来源 = 固定值 / 字段取值」的切换。新增操作符时，这张表、`ALL_CONDITION_OPERATORS` 与 `schemas.ts` 的 zod enum 三处必须同步，`operator-meta.test.ts` 负责拦住漂移。

---

## 3. 核心抽象：Node 与 Execution Model

### 3.1 节点结构

每个节点都遵循统一抽象：

```ts
interface WorkflowNodeBase {
  id: string
  kind: WorkflowNodeKind
  name: string
  enabled: boolean
  description: string
  position: { x: number; y: number }
}
```

每种节点都可以额外携带自己的配置字段。这样 UI 可以按 kind 渲染不同配置面板，而执行器可以通过 kind 分发逻辑。

### 3.2 运行时行为

路由执行器从输入节点开始，按边关系遍历节点，直到：

- 到达输出节点；
- 当前节点没有后继；
- 发生错误；
- 进入最大步数保护。

执行时会维护：

- 当前 payload
- 当前落点（`route.modelIds`）
- trace 列表
- stopReason

这样执行结果既可以用于 UI 测试，也适合真实生产环境调试。

### 3.3 节点输入输出接口设计

路由图里不应把“一个节点只允许一个输入、一个输出”当作硬约束。真实路由场景常常是多对多：

- 一个节点可能同时读取多个来源字段；
- 一个条件节点可能向多个分支输出；
- 一个聚合节点可能接收多个输入并合并后发出单一输出；
- 一个节点可能在不同条件下发出不同输出端口。

但在本设计里，所有路由节点都围绕同一个核心：选择目标逻辑模型。因而端口的语义不是“改写请求”，而是“决定落点”。

因此，建议为每个节点设计统一的端口协议：

```ts
interface NodePort<T = unknown> {
  id: string
  name: string
  kind: 'payload' | 'context' | 'model' | 'signal' | 'branch'
  schema: T
  cardinality: 'single' | 'multi'
  required: boolean
  description: string
}

interface NodeIOContract<TIn = unknown, TOut = unknown> {
  inputs: NodePort<TIn>[]
  outputs: NodePort<TOut>[]
}
```

多数路由节点应当遵循“强类型输入 + 明确输出”的保证，例如：

```ts
type RouteContext = {
  request: Record<string, unknown>
  metadata: Record<string, unknown>
  traceId: string
}

interface InputNodeContract extends NodeIOContract<
  { request: unknown; metadata?: Record<string, unknown> },
  { payload: unknown; context: RouteContext }
> {}

interface ConditionNodeContract extends NodeIOContract<
  { payload: unknown; context: RouteContext },
  { true: { payload: unknown; context: RouteContext }; false: { payload: unknown; context: RouteContext } }
> {}

interface ModelSelectNodeContract extends NodeIOContract<
  { payload: unknown; context: RouteContext },
  { modelIds: string[] }
> {}

interface OutputNodeContract extends NodeIOContract<
  { payload: unknown; context: RouteContext; modelIds: string[] },
  { modelIds: string[]; routeDecision: { matched: boolean; modelIds: string[] } }
> {}
```

这意味着：多端口不等于“泛类型无约束”。真正的业务节点仍然应该具备明确的输入与输出契约，只是允许同一节点同时承载多个有定义的输入/输出口，并且输出的是“选择结果”，而不是“改写请求内容”。

并且，边的语义也从“单一 next”扩展为端口级连接：

```ts
interface EdgeConnection {
  fromNodeId: string
  fromPortId: string
  toNodeId: string
  toPortId: string
  condition?: string
  weight?: number
}
```

这样可以支持以下几种真实模式：

- 1:N：一个输入数据分发到多个后续节点；
- N:1：多个输入统一合并后再处理；
- N:M：多个字段写入多个输出端口，并根据条件选择分支。

在图执行时，节点只需读取定义好的输入端口，按端口输出结果，而不是强行依赖 `next` 和 `nextTrue` 的单路径假设。这样更符合真实系统行为，也更适合后续扩展为可视化调试面板。

> 设计原则：节点所见的接口是“端口”，而不是“单一指针”。端口允许同一节点在不同上下文下发出多个结果，扩展性比单 `next` 更强。

---

## 4. 核心节点设计

路由工作台最终应只保留“路由决策”相关节点，其他修改请求内容的逻辑属于独立 rewrite layer，不进入路由图核心执行路径。

### 4.1 Input

核心作用：
- 作为整个路由的入口；
- 接收原始请求；
- 产生统一上下文。

输入：
- `request`
- `headers`
- `metadata`

输出：
- `payload`
- `context`

说明：
- 这是所有后续节点的统一起点；
- 输入端口可以多，但必须是清晰的上下文对象。

配置体验：
- request / headers / metadata 提供结构化编辑器与字段补全；
- 支持导入示例请求自动推断字段类型并生成初始 schema；
- 必填字段缺失时在节点上直接标记错误。

---

### 4.3 Condition

核心作用：
- 进行布尔判断；
- 把一条路径拆成 `true` / `false` 两个分支。
- 承担原 Filter 的准入判断能力（如黑白名单、来源校验、模型可用性校验）。

输入：
- `payload`
- `context`

输出：
- `branch:true`
- `branch:false`

说明：
- 是路由图最基础的控制流节点；
- 适合做条件分发、功能分流和权限判断。
- 通过“规则模板 + 逻辑组合”可以覆盖原 Filter 的使用场景，无需单独 Filter 节点。

配置体验（类型感知输入提示）：
- 根据上游节点输出端口的 schema 自动列出可选字段路径（如 `context.metadata.protocol`、`payload.model`）；
- 根据字段类型给出操作符建议：
  - `string`: `equals` / `contains` / `in`
  - `number`: `>` / `<` / `between`
  - `boolean`: `is true` / `is false`
  - `enum`: 下拉选项
- 值输入区根据类型切换控件（文本框、数字框、开关、枚举选择）；
- 当上游端口 schema 变化时，已配置规则给出兼容性提示与修复建议。

---

### 4.3 ModelSelect

核心作用：
- 指定一个或多个逻辑模型 ID；
- 将明确的逻辑模型选择交给 Output 节点。

输入：
- `payload`
- `context`

输出：
- `modelIds: string[]`

说明：
- ModelSelect 只表达逻辑模型选择，不负责协议识别、模型评分或请求改写；
- 逻辑模型 ID 经过去重和空值清理后写入运行时 payload 的 `route.modelIds`；
- 多个 ID 表示 Output 可以用这组逻辑模型作为落点。

配置体验：
- 支持选择一个或多个逻辑模型，并提供搜索与去重；
- 输出结果展示最终 `modelIds`，便于审计和调试；

---

### 4.5 Output

核心作用：
- 是路由终点；
- 返回最终决策结果或输出路径。

输入：
- `payload`
- `context`
- `routeDecision`

输出：
- `result`
- `finalTarget`

说明：
- 最终输出可以是选中的逻辑模型、终止状态或可观测结果；
- 这是路由图的终止节点。

配置体验：
- 可选择输出摘要级别（简要/详细）以适配不同调试场景；
- 输出字段支持一键复制为调试样例；
- 可配置是否附带完整 trace。

---

### 4.6 脚本节点（Script）

核心作用：
- 作为**逃生舱**：当「条件 + 变量取值」表达不出某个判断时，让用户用一小段 JS 把结论算出来写回 payload；
- 让「未定义 / 未知类型」的数据也能被处理，与 §2.9 的 `unknown` 设计同一套思路。

输入：
- `payload`（本次运行数据的深拷贝）
- `get(路径)`（与条件节点同一套路径语义，含 `a[*].b` 通配投影）
- `console`（`log / warn / error`，日志回传 trace 详情）

输出：
- `resultPath` 指向的写回路径（默认 `route.scriptResult`），值为脚本 `return` 的任意类型

说明：
- 脚本文本是**函数体**，用 `return` 交回结果；写回值静态类型记为 `unknown`，下游条件节点不限制操作符，语义交给运行时；
- 沙箱里没有 `require` / `import` / `eval` / 网络 / 文件系统，超时即中断（见 [security-privacy.md](./security-privacy.md)）；
- 脚本执行失败（空源码、异常、超时、写回路径为空）记 `success: false` 的 trace，但不阻断执行，图继续往下走；
- 沙箱能力由执行方注入（`RunCapabilities.runScript`），引擎自身不依赖任何运行时模块：渲染进程里做静态推演时该节点只是「能力缺失」，服务端执行时才真正跑。

配置体验：
- 源码区等宽字体编辑，并提供「插入字段」快捷项（把 `get('路径')` 追加到脚本里）；
- 结果写回路径提供字段候选表；空源码 / 未配置路径时面板直接给出警告；
- 超时可调，上限与引擎夹取用的是同一个常量（`SCRIPT_TIMEOUT_LIMIT`）。

---

### 4.7 LLM 节点（Prompt）

核心作用：
- 用**指定逻辑模型**执行一段提示词，把模型回复写回 payload；
- 让「按语义挑选落点」这类无法用规则表达的策略也能进路由图。

输入：
- `payload`（用于提示词模板插值）

输出：
- `resultPath` 指向的写回路径（默认 `route.promptResult`），值为回复文本

说明：
- 提示词模板支持 `${路径}` 插值，取值不存在的变量渲染成空串，不会打断链路；
- 「指定逻辑模型」直接复用逻辑模型体系：服务端按该逻辑模型自己的上游配置（供应商、协议、密钥、故障转移）执行，因此提示词走的是和真实请求**同一条通路**，路由图里不需要再配一遍供应商与协议；
- 未选择逻辑模型、执行能力缺失、上游失败、超时都记 `success: false` 的 trace，不阻断执行；
- trace 详情会带上实际命中的上游（`target`），便于确认提示词最终打到了哪个模型；
- 调用能力同样由执行方注入（`RunCapabilities.runPrompt`）。

配置体验：
- 逻辑模型下拉直接列出当前可用逻辑模型，并对「已停用」「已不存在」给出提示；
- 系统提示词 / 提示词分别编辑，提示词支持「插入字段」生成 `${路径}`；
- 温度（0–2）、最大回复长度、超时（上限 `PROMPT_TIMEOUT_LIMIT`）可调；
- 回复写回路径提供字段候选表，未配置时给出警告。

---

## 5. 节点输入输出接口规范

路由节点需要“强类型 + 多端口”，但不等于“无类型”；其核心语义是：通过请求选择最终逻辑模型，而不是改写请求内容。

```ts
interface NodePort<T = unknown> {
  id: string
  name: string
  kind: 'payload' | 'context' | 'model' | 'signal' | 'branch'
  schema: T
  cardinality: 'single' | 'multi'
  required: boolean
  description: string
}

interface NodeIOContract<TIn = unknown, TOut = unknown> {
  inputs: NodePort<TIn>[]
  outputs: NodePort<TOut>[]
}
```

### 5.1 路由节点的典型契约

```ts
type RouteContext = {
  request: Record<string, unknown>
  metadata: Record<string, unknown>
  traceId: string
}

interface InputNodeContract extends NodeIOContract<
  { request: unknown; metadata?: Record<string, unknown> },
  { payload: unknown; context: RouteContext }
> {}

interface ConditionNodeContract extends NodeIOContract<
  { payload: unknown; context: RouteContext },
  { true: { payload: unknown }; false: { payload: unknown } }
> {}

interface ModelSelectNodeContract extends NodeIOContract<
  { payload: unknown; context: RouteContext },
  { modelIds: string[] }
> {}

interface OutputNodeContract extends NodeIOContract<
  { payload: unknown; context: RouteContext; modelIds: string[] },
  { modelIds: string[]; routeDecision: { matched: boolean; modelIds: string[] } }
> {}
```

### 5.2 关键约束

- 输入端口可以多个，但每个端口都有定义的 schema；
- 输出端口可以多个，但通常是强类型分支；
- 不允许“任意节点随意写改请求内容”；
- 真正属于路由编排的节点，应该只负责判断和选择。

### 5.3 所有可配置节点的类型感知约束

- 任意可配置节点都应从上游输出端口读取 schema，并实时生成字段可选列表；
- 未绑定 schema 的输入端口，只允许使用基础表达式模式，并在 UI 标记为“弱类型”；
- 保存配置时必须进行类型校验，避免 `number` 字段使用 `contains` 等无效操作；
- 配置面板应提供“字段来源”提示（来自哪个上游节点与端口）；
- 节点 trace 需要记录“关键输入 + 关键参数 + 结果”，以便回放时定位判定原因；
- schema 变更后，受影响节点必须显示兼容性告警，并提供一键修复建议。

### 5.4 节点配置体验的统一能力

- 字段路径选择器：支持层级浏览、搜索、最近使用；
- 类型驱动控件：string/number/boolean/enum 使用不同控件；
- 模板系统：常见规则可一键插入（协议识别、租户路由、模型降级）；
- 预执行验证：保存前给出静态校验结果与示例输入的模拟执行结果；
- 错误就地反馈：在节点卡片与配置项位置同时显示错误原因。

---

## 6. 最终结论

路由编排的核心节点应当只包含：

1. Input
2. Condition（可选）
3. ModelSelect
4. Output

它们构成了“路由”的最小完整闭环：

- 接收请求；
- （可选）判断分支；
- 选定目标逻辑模型；
- 输出最终决策。

这与“请求内容改写”是分离的。后者属于规则层、转换层或重写管线，不属于路由编排核心实现。

> 结论：整个流程可以理解为：根据请求，选择最终的逻辑模型，而不是改造请求内容。
