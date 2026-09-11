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

Iteration 和 Loop 是结构化控制流节点：

- `body` 是循环体入口，循环体执行完毕后经边回到循环节点自身；
- `out` 是循环完成或退出后的出口；
- `maxIterations` 是单个 Loop 的业务预算，全局步骤预算只负责防止恶意或错误图无限执行。

运行时循环状态属于一次执行，不写回用户配置。公开的 `metadata.iteration` 和 `metadata.loop` 是当前循环作用域的投影，离开循环后清理。

## 输出契约

引擎每次运行返回 `{ outputPayload, protocol, queueSelections, stopReason, trace }`：

- `outputPayload` 是入参 payload 的克隆，其中 `metadata` 归调用方所有、引擎只读；
- 引擎自己产出的数据统一写在顶层 `route` 命名空间（决策结果 + 决策依据），字段定义见 [route-design.md](./route-design.md) §2.6；
- 协议归一化结果、每个节点的判定明细等过程性数据只进 `trace`。

`queue-select` 节点的取值来源决定落点：

- `fixed`：使用节点上配置的队列列表；
- `variable`：读取 `variablePath` 指向字段的取值作为落点（字符串 → 单个队列 id，字符串数组 → 队列 id 列表），取不到时使用节点上的兜底队列；兜底队列为空则不产出落点。

条件规则的比较值也支持来自字段（`valueSource: 'field'` + `valueFieldPath`），因此「请求模型是否在逻辑队列列表里」这类判断完全由条件节点完成，引擎不预计算业务结论。

引擎不内置「跟随请求模型」这类专用语义，默认策略由 `Input → Condition(route.requestedModel in route.availableQueueIds) → QueueSelect(变量) / QueueSelect(固定 default) → Output` 组合而成，见 [route-design.md](./route-design.md) §2.7。

抓不到任何队列时该节点仍产出 trace，`success` 为 `false`，但不阻断执行。

## 校验层次

1. **形状校验**：`WorkflowNodeModelSchema` 与 `WorkflowEdgeSchema` 校验节点和边的字段类型。
2. **图校验**：校验节点引用、入口/出口、可达性和端口合法性。
3. **运行时保护**：执行器使用动态全局步骤预算，并返回 `max-steps`，不把它误认为 Loop 正常退出。

## 持久化

Router localStorage 使用带版本的图文档，这是唯一的持久化格式：

```ts
{ version: 1, nodes: WorkflowNodeModel[], edges: WorkflowEdge[] }
```

读取时执行 JSON 解析、Zod `safeParse` 和图校验。任何旧格式（裸节点数组、节点内嵌连接字段）都不再被读取或迁移。

## 后续演进

当需要支持嵌套循环和真正的容器子图时，应把循环体从“手动回边”升级为结构化 body 子图，并以执行作用域栈承载嵌套状态。该迁移不应与本次图视图和校验混在一起。
