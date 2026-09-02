# 路由工作台设计文档

## 1. 背景与目标

One Switch 既是本地代理，也是一套请求路由与模型选择系统。为了让路由逻辑从“隐式条件分支”升级为“可视化、可调试、可复用”的执行图，设计了“路由工作台”：以节点图的方式描述一条请求如何被识别、过滤、判定，并最终落到某个逻辑模型 / 队列。

路由工作台解决的核心问题包括：

- 让请求通路不再依赖代码分支散落各处；
- 让协议发现、条件判断、模型选择逻辑可视化；
- 让非开发人员也能理解一条请求如何被选到目标模型；
- 让调试更容易，因为每个节点都能留下 trace。

路由不是“编排内容修改”，而是“根据请求选择最终要求的逻辑模型/队列”。它强调：

- 入口统一；
- 协议语义清晰；
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
- 将请求交给对应队列或 provider chain。

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
    headers: {},
    body: {}
  },
  metadata: {
    protocol: 'openai',
    client: 'cursor',
    traceId: '...'
  }
}
```

后续节点统一对该对象读取或写入，而不是去猜测 API 差异。

### 2.4 最小默认路径

路由图不要求所有节点都出现在同一张图里。默认最小链路是：

Input -> ProtocolDiscovery -> ModelSelector -> Output

复杂链路通过条件和策略分支扩展。

### 2.5 全局配置体验优先

不仅 Condition，任何“可输入、可配置”的节点都应提供类型感知与上下文感知体验：

- 配置项来自上游端口 schema，而不是自由文本猜字段；
- 操作符、候选值、输入控件应随字段类型自动切换；
- 配置保存前必须做类型校验与可执行性校验；
- schema 变化后需要给出迁移提示，避免静默失效。

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
- 当前 queue
- trace 列表
- stopReason

这样执行结果既可以用于 UI 测试，也适合真实生产环境调试。

### 3.3 节点输入输出接口设计

路由图里不应把“一个节点只允许一个输入、一个输出”当作硬约束。真实路由场景常常是多对多：

- 一个节点可能同时读取多个来源字段；
- 一个条件节点可能向多个分支输出；
- 一个聚合节点可能接收多个输入并合并后发出单一输出；
- 一个节点可能在不同条件下发出不同输出端口。

但在本设计里，所有路由节点都围绕同一个核心：选择目标逻辑模型 / 队列。因而端口的语义不是“改写请求”，而是“决定落点”。

因此，建议为每个节点设计统一的端口协议：

```ts
interface NodePort<T = unknown> {
  id: string
  name: string
  kind: 'payload' | 'context' | 'queue' | 'signal' | 'branch'
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

type LogicalModelDecision = {
  selectedModel: string
  targetQueue: string
  fallbackQueue?: string
  matched: boolean
}

interface InputNodeContract extends NodeIOContract<
  { request: unknown; metadata?: Record<string, unknown> },
  { payload: unknown; context: RouteContext }
> {}

interface ConditionNodeContract extends NodeIOContract<
  { payload: unknown; context: RouteContext },
  { true: { payload: unknown; context: RouteContext }; false: { payload: unknown; context: RouteContext } }
> {}

interface ModelSelectorNodeContract extends NodeIOContract<
  { payload: unknown; context: RouteContext; candidateModels: string[] },
  { selectedModel: string; targetQueue: string; fallbackQueue?: string; routeDecision: LogicalModelDecision }
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

### 4.2 ProtocolDiscovery

核心作用：
- 发现当前请求属于哪种接口协议；
- 识别后为不同协议类型输出各自的连接点；
- 将请求分发到对应的协议分支。

输入：
- `request.path`
- `request.headers`
- `payload`

输出连接点：
- `openai`
- `anthropic`
- `gemini`
- `custom`
- `unknown`

说明：
- 这是路由图的第一层语义判断；
- 它不是单一判断，而是把不同协议类型暴露成独立的分支连接点；
- 每个协议类型都对应一个明确的后续输出端口；
- 例如：`openai -> ModelSelector`，`anthropic -> ModelSelector`，`unknown -> Condition` 或 `Output`。

配置体验：
- path 匹配规则和 header 匹配规则提供模板（OpenAI/Anthropic/Gemini 常见路径）；
- 协议分支输出口固定展示并可预览“最近命中率”；
- unknown 分支默认给出建议落点（Condition 或 Output），减少空分支配置。

示意：

```text
ProtocolDiscovery
  ├─ openai -> ModelSelector
  ├─ anthropic -> ModelSelector
  ├─ gemini -> ModelSelector
  ├─ custom -> ModelSelector
  └─ unknown -> Output
```

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

### 4.4 ModelSelector

核心作用：
- 根据请求选择最终逻辑模型；
- 决定请求落到哪条队列 / provider chain。

输入：
- `payload`
- `context`
- `candidateModels`

输出：
- `targetQueue`
- `selectedModel`
- `fallbackQueue`
- `routeDecision`

说明：
- 这是路由中的最终决策节点；
- 它的职责是选择“目标逻辑模型 + 目标队列”，不是改写请求字段。

配置体验：
- candidateModels 支持按协议、租户、客户端分组展示与搜索；
- 评分策略（延迟、成本、成功率）提供可视化权重滑杆；
- fallbackQueue 必填策略可配置（强制/可选），并在缺失时给出阻断提示。

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
- 最终输出可以是选中的逻辑模型、目标队列、终止状态或可观测结果；
- 这是路由图的终止节点。

配置体验：
- 可选择输出摘要级别（简要/详细）以适配不同调试场景；
- 输出字段支持一键复制为调试样例；
- 可配置是否附带完整 trace。

---

## 5. 节点输入输出接口规范

路由节点需要“强类型 + 多端口”，但不等于“无类型”；其核心语义是：通过请求选择最终模型和队列，而不是改写请求内容。

```ts
interface NodePort<T = unknown> {
  id: string
  name: string
  kind: 'payload' | 'context' | 'queue' | 'signal' | 'branch'
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

interface ModelSelectorNodeContract extends NodeIOContract<
  { payload: unknown; context: RouteContext; candidateModels: string[] },
  { selectedModel: string; targetQueue: string; fallbackQueue?: string; routeDecision: { matched: boolean } }
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
2. ProtocolDiscovery
3. Condition
4. ModelSelector
5. Output

它们构成了“路由”的最小完整闭环：

- 接收请求；
- 识别协议；
- 判断分支；
- 选定目标逻辑模型和队列；
- 输出最终决策。

这与“请求内容改写”是分离的。后者属于规则层、转换层或重写管线，不属于路由编排核心实现。

> 结论：整个流程可以理解为：根据请求，选择最终的逻辑模型 / 队列，而不是改造请求内容。
