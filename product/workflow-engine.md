# Router 工作流引擎设计

## 设计结论

Router 使用 **节点配置 + 显式边图 + 结构化控制流状态** 的分层模式：

- 节点配置描述节点职责和业务参数，不携带任何连接信息；
- 边图（`WorkflowGraph.edges`）是控制流的唯一事实来源，统一描述 `out`、`body`、`else`、条件分支端口和协议分支端口；
- 执行器负责控制流、循环预算和运行时作用域；
- Zod 负责数据形状，图校验负责引用、入口、出口和可达性。

节点模型不再保存 `next`、`bodyNext`、`elseNext` 或 `branches`。所有连接都通过边表达，字段推导（`resolveInputHints`）与执行器（`runWorkflow`）都直接消费 `WorkflowGraph`。

## 工作流图

```ts
interface WorkflowGraph {
  version: 1
  nodes: WorkflowNodeModel[]
  edges: WorkflowEdge[]
}

interface WorkflowEdge {
  id: string
  sourceNodeId: string
  sourcePort: WorkflowSourcePort
  targetNodeId: string
}

type WorkflowSourcePort = 'out' | 'body' | 'else' | WorkflowProtocol | (string & {})
```

`sourcePort` 是节点发出的端口：

- `out`：单出口节点的默认出口；
- `body`：Iteration/Loop 的循环体入口；
- `else`：Condition 未命中任何分支时的出口；
- 条件分支的 case id 作为端口名（如 `case-1`）；
- 协议分支端口名来自 `WORKFLOW_PROTOCOLS`（`openai-completions`、`openai-responses`、`anthropic-messages`、`unknown`）。

边必须引用存在的节点。每个工作流应有且只有一个 `input` 和至少一个 `output`；所有从入口可达的节点引用都必须闭合。图校验在保存和服务端执行前进行。

## 控制流

循环由专门的 **`iteration`（遍历迭代）节点** 表达，它是结构化控制流节点，配置完全落在节点自身：

```ts
interface IterationNode extends WorkflowNodeBase {
  kind: 'iteration'
  sourcePath: string                  // 遍历来源，支持通配投影（如 logicalModels[*].id）
  collectPath: string                 // 每轮结束后读取的结果路径（判定本轮是否命中）
  collectMode: 'first' | 'last' | 'list' | 'count'
  resultPath: string                  // 汇总结果写回路径
  maxIterations: number               // 业务轮数上限
}
```

约定：

- **`body` 是循环体入口，`out` 是循环完成后的出口**；
- 循环体末端经边**回到迭代节点自身**即表示“本轮结束”，不需要隐式子图；执行器用 `stopAt` 把回边当成轮次边界；
- 每轮开头把当前作用域投影写入 `route.iteration = { source, item, index, key, total }`，循环体里的条件可直接选 `route.iteration.item.enabled` 这类路径；
- 遍历来源是数组时按元素展开（`key` 是下标），是对象时按键值对展开（`key` 是键名），是标量时当成只有一项的集合；取不到时为 0 项，直接写回空结果；
- `collectMode` 决定汇总方式：`first` 命中即停止，`last` 保留最后一个命中值，`list` 汇总所有命中值，`count` 只记轮数（不受命中影响）；
- `maxIterations` 是单个迭代节点的业务预算，全局步骤预算只负责防止恶意或错误图无限执行；被上限截断时会在 trace 的 `stoppedReason` 里写明剩余项数。

循环状态属于一次执行，不写回用户配置。旧版设计里设想的 `metadata.iteration` / `metadata.loop` 没有落地：作用域统一收在 `route.iteration` 下，离开循环后它就是最后一轮的值，调用方读不读都不影响流程。

## 输出契约

引擎每次运行返回 `{ outputPayload, protocol, nodeOutputs, stopReason, trace }`：

- `outputPayload` 是入参 payload 的克隆，其中 `metadata` 归调用方所有、引擎只读；
- 引擎自己产出的数据统一写在顶层 `route` 命名空间（决策结果 + 决策依据），字段定义见 [route-design.md](./route-design.md) §2.6；
- `nodeOutputs` 是 `Record<节点 id, NodeOutput[]>`：每个节点可以登记多条输出（控制项、条件分支、落点…），节点 id 由渲染侧换成节点名称做分组标题，因此“谁产出了什么”直接可见；
- 协议归一化结果、每个节点的判定明细等过程性数据只进 `trace`。

`model-select` 节点的取值来源决定落点：

- `fixed`：使用节点上配置的逻辑模型列表；
- `variable`：读取 `variablePath` 指向字段的取值作为落点（字符串 → 单个逻辑模型 id，字符串数组 → 逻辑模型 id 列表），取不到时使用节点上的兜底逻辑模型；兜底列表为空则不产出落点。

条件规则的比较值也支持来自字段（`valueSource: 'field'` + `valueFieldPath`），因此「请求模型是否在逻辑模型列表里」这类判断完全由条件节点完成，引擎不预计算业务结论。

引擎不内置「跟随请求模型」这类专用语义，默认策略由 `Input → Condition(route.requestedModel in logicalModels[*].id) → ModelSelect(变量) / ModelSelect(固定 default) → Output` 组合而成，见 [route-design.md](./route-design.md) §2.7。

抓不到任何逻辑模型时该节点仍产出 trace，`success` 为 `false`，但不阻断执行。

### 路径取值

所有节点读数据都走同一套路径语法（解析器在 `engine.ts`，字段候选表在 `field-hints.ts`，两边共用 `PATH_WILDCARD_SUFFIX`）：

- `a.b.c`：逐层取字段；
- `a[*].b`：先把 `a` 展开成元素集合，对每个元素取 `b`，最后拍平一层。

因此「取数组里每个元素的某个属性再整体判定」不需要新节点：`logicalModels[*].id`、`request.body.items[*].type` 都是合法路径。写回也走同一套语法（汇总结果用 `setByPath` 写入 `resultPath`，路径不存在时会创建中间对象）。

### 类型与操作符

字段类型由采样值推断（`string` / `number` / `boolean` / `enum` / `array` / `object` / `unknown`），只影响 UI 中的候选操作符集合，**不影响运行时语义**：

- `array` / `object` 字段暴露整体判定操作符（`contains`、`empty`、`notEmpty`、`equals`…）；
- `unknown` 字段不限制操作符，运行时按实际取值决定语义 —— 数组元素、未定义字段、将来的动态脚本产出都走这条路，等价于“按动态脚本那样处理”。

运行时语义是类型感知的：`empty` 看数组长度 / 对象键数 / 去空白后的字符串，`contains` 在数组上比较元素、在对象上比较键名、其余退化成子串，`equals` 对对象 / 数组先按结构化序列化比较。详见 [route-design.md](./route-design.md) §2.9。

## 校验层次

1. **形状校验**：`WorkflowNodeModelSchema` 与 `WorkflowEdgeSchema` 校验节点和边的字段类型。
2. **图校验**：校验节点引用、入口/出口、可达性和端口合法性。
3. **运行时保护**：执行器使用全局步骤预算（`MAX_STEPS = 2000`，循环体内外共用同一个计数器），超出时返回 `max-steps`，不把它误认为 Loop 正常退出。

## 持久化

Router localStorage 使用带版本的图文档，这是唯一的持久化格式：

```ts
{ version: 1, nodes: WorkflowNodeModel[], edges: WorkflowEdge[] }
```

读取时执行 JSON 解析、Zod `safeParse` 和图校验。任何旧格式（裸节点数组、节点内嵌连接字段）都不再被读取或迁移。

## 后续演进

当需要支持嵌套循环和真正的容器子图时，应把循环体从“手动回边”升级为结构化 body 子图，并以执行作用域栈承载嵌套状态（目前 `route.iteration` 只有一层作用域，嵌套循环会互相覆盖）。该迁移不应与本次图视图和校验混在一起。
