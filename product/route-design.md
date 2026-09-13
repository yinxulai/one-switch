# 路由工作台设计文档

> **本文负责产品语义**：路由要表达什么、`route` 输出契约、路径取值与类型/操作符、默认策略与预设、节点目录、代理如何接上图。
> **引擎实现**（图模型、边与端口、控制流、循环、能力注入、校验、持久化）在 [workflow-engine.md](./workflow-engine.md)；**画布交互**在 [route-workbench.md](./route-workbench.md)。

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

**入口节点不解析请求体**：`body` 对入口来说是不透明的——它只知道「有一个体」，不知道体里有哪些字段，更不知道是什么格式。请求体的格式与字段语义**属于协议层**：消息在 `messages` 还是 `input`、系统提示词在 `system` 还是 `instructions`、模型名写在哪，三种协议各不相同。要入口节点报出 `request.body.model`，就等于要求它兼容所有协议，这显然办不到——而是入口**本来就不该知道**这件事。所以这一层交给**协议发现节点**：它按命中的协议把请求体的形状声明给下游，字段候选表也按协议分支给出（声明表在 `source/common/router/request-shape.ts`）。声明的是**请求体里的真实位置，不是解析结果的副本**——副本会多出第二个事实源。`unknown`（认不出协议）刻意不声明任何字段：不确定就别声称。

声明表同时是**引擎读体的唯一入口**：引擎自己要用到的两条（模型名、消息列表）在表里各占一个 `role`，引擎按 role 取路径（`requestBodyField`），而不是在代码里再写一遍「先找 `messages`、找不到再找 `input`」——那种兜底顺序就是声明表的第二份副本，今天恰好对、换种协议就静默跑偏（`/v1/responses` 的消息在 `input` 里，而 `messages` 可能另有所指）。协议发现节点的 trace 归一化视图与运行面板上那一行「请求模型」都取自这同一处。

这条规矩一直贯穿到运行面板：输入节点的运行输出**只报 `logicalModels`**，请求模型显示在协议发现节点上——只有它知道模型名写在哪；认不出协议时那个值就是空的，不按别的协议猜。

上下文里还可以带上调用方已经确定的两个值：`protocol`（`openai-completions` / `openai-responses` / `anthropic-messages`）与 `transport`（`http` / `http-stream` / `websocket`，**传输形态**：这条对话在线上长什么样）。入口在认路径时就已经知道协议，从请求体拿出 `stream` 后就知道形态；引擎优先采信声明值，只有缺省时才按路径与请求头做启发式识别——避免同一次运行里两套依据各算一遍。

这两个词表共用 `@common/schemas`，不要再立一套「工作流传输」枚举。它们都是**一手事实**：`protocol` 由端点匹配得出，`transport` 由客户端请求体里的 `stream` 直接读出——`stream: true` 就是 `http-stream`，不存在需要算的乘积，也不存在回推不出的投影。所以图上裸露的就是 `route.protocol` 与 `route.transport` **两个字段**，它们就是 [proxy-engine.md](./proxy-engine.md) §1.1 里定义的那两个词，不在路由层另起含义。这根轴只有一格：连接形态由端点地址的 scheme 表达（`wss://` = WebSocket），不存在按跳复制的第三个枚举（`engine.ts` 的 `writeRouteProtocol` 与 `field-hints.ts` 都有逐字说明）。

后续节点统一对该对象读取或写入，而不是去猜测 API 差异。

### 2.4 最小默认路径

路由图不要求所有节点都出现在同一张图里。默认最小链路是：

Input -> ModelSelect -> Output

复杂链路通过条件和策略分支扩展。要按**请求自己的字段**判定（例如请求里写的模型名），中间接一个协议发现节点：`Input -> 协议发现 -> Condition -> …`，请求体字段由它声明给下游（见 §2.3、§4.1）。

### 2.5 全局配置体验优先

不仅 Condition，任何“可输入、可配置”的节点都应提供类型感知与上下文感知体验：

- 配置项来自上游端口 schema，而不是自由文本猜字段；
- 操作符、候选值、输入控件应随字段类型自动切换；
- 操作符必须同时给出中文名称与一句话语义说明（`equals` 这类标识符只作为次要信息），因为用户读到的说明就是他对判定行为的唯一预期；
- 配置保存前必须做类型校验与可执行性校验；
- schema 变化后要能明确报出「这条配置不再成立」，不做静默降级；
- 字段路径选择器支持层级浏览、搜索与最近使用，候选表（`field-hints.ts`）与运行时取值（`engine.ts`）共用同一套路径语法；
- 保存前给出静态校验结果，并用示例输入模拟执行一次；
- **每个节点的面板里只有一条「这个节点是什么」的定位句**：由面板外壳统一渲染（`node-meta.ts` 的 `nodePanelHint` → `router.panelHint.*`），面板正文只写与当前配置项直接相关的补充说明和告警，同一件事不在一个节点里说两遍（`components/workflow-node-panel.test.tsx` 会逐节点比对定位句与正文说明）。

### 2.6 输出契约：`route` 命名空间

路由执行器不修改调用方的 `metadata`（`metadata` 归调用方所有，引擎只读），所有由路由自身产生的数据都写在 payload 顶层的 `route` 对象里：

```ts
interface RouteDecision {
  traceId: string                      // 本次运行的追踪 id
  protocol: WorkflowProtocol           // 识别到的请求协议，未识别为 unknown
  transport: TransportKind             // http | http-stream | websocket —— 客户端跳的传输形态（事实）
  modelIds: string[]                   // 最终落点逻辑模型（决策结果）
  fallback: boolean                    // 是否走了兜底策略
  controls: Record<string, unknown>    // 控制输入节点注入的运行时取值
  iteration?: RouteIterationScope      // 遍历迭代节点写下的「当前轮」作用域
}
```

约定：

- **决策结果**（`modelIds`）与**决策依据**（`protocol` / `transport` / `controls` …）都放在 `route` 下，条件节点可直接按 `route.*` 选字段；
- **请求模型不存副本**：「客户端请求的是哪个模型」就是请求自己的字段（`request.body.model`），图里的条件与变量取值直接按那个路径读。在 `route` 下再存一份只会多出第二个事实源：一旦副本与请求不同步（脚本节点改过请求体、入口与引擎各自读一遍），就没人说得清哪个是真的。入口仍然会用协议的**封装描述**（`ProtocolEnvelope.readModel`）读一次模型名，但那是它自己的事（400 校验 + 它自己的 `[proxy]` 日志），不进图 —— 那一次读到的值只在日志里就地引用，`RouteResolutionInput` 里没有这个字段，也没有为它留过任何变量。要注意这条路径**不是入口节点报出来的**：入口只给 `request.body` 整体，`request.body.model` 由协议发现节点按命中的协议声明，因此默认策略里协议发现是必经的一环（§2.7）。运行面板也一样：输入节点下没有「请求模型」这一行，它在协议发现节点下 —— 引擎没有任何地方绕过声明表去读请求体；
- **协议与形态是同一层的两个平级事实**：`route.protocol` 与 `route.transport` 都是**一手事实**，分别由端点匹配和请求体里的 `stream` 读出，谁也不是谁的投影，也没有需要按跳复制的第三个词。要注意的是：**流式不属于「连接方式」**——SSE 只是 `http-stream` 这一档的线格式，连接本身还是一根 HTTP 请求；也**不要把客户端形态喂给规划器**——上游跳用 `http` 还是 `http-stream` 由 `resolveUpstreamTransport()` 从上游端点地址与客户端跳推出来（`wss://` → `websocket`，否则镜像客户端跳），而客户端偏好从来不改变哪个上游端点合法：`PlannerInput` 里没有任何传输字段。详见 [proxy-engine.md](./proxy-engine.md) §1.1 与 §2.3；
- **可推导的数据不落库**：像「本次可见的逻辑模型 id 列表」这种由 `logicalModels` 直接推出来的数组不再单独写进 `route`，需要时用通配投影 `logicalModels[*].id` 现算（见 §2.8）；
- **过程性数据**只进 trace，不进 payload —— 例如协议归一化后的请求体（`{protocol, transport, model, messages}`）与每个节点的判定明细，避免 payload 里出现只有调试才看的字段；
- **引擎不预计算业务判定**：像「请求模型是否命中逻辑模型列表」这种结论由条件节点在图上现场算出，引擎只提供原始字段（`request.body.model` 与 `logicalModels`）；
- **运行结果按节点组织**：`runWorkflow` 返回的 `nodeOutputs` 是 `Record<节点 id, NodeOutput[]>`，每个节点可以登记多条输出（控制项、条件分支、落点…），渲染时再查节点名称作为分组标题，因此「谁产出了什么」看得见；
- **运行时的输入键是封闭的**：只有 `request` 与 `logicalModels` 两项，加上入口已经确定的 `protocol` / `transport` 两个事实，不存在别的输入键。

### 2.7 默认策略：模型直达

系统内建一条默认策略，任何时刻都可通过页头的「策略」下拉一键选回；一版图都没保存过时，代理跑的就是它：

> 请求里的 `model` 命中我们的逻辑模型 id 时，请求该逻辑模型；否则请求默认逻辑模型（`default`）。

这条策略**不引入任何专用节点**，完全用基础节点拼出来，命中判断就是一条普通的「字段 in 字段」条件：

```text
Input ─▶ 协议发现 ─▶ Condition（request.body.model in logicalModels[*].id）
                       ├─ IF   ─▶ ModelSelect（取值来源 = 变量 request.body.model）─▶ Output
                       └─ ELSE ─▶ ModelSelect（取值来源 = 固定逻辑模型 default）───▶ Output
```

中间必须过一道协议发现节点：请求模型是**协议层**的事实，入口节点不解析请求体（§2.3），所以 `request.body.model` 这个路径由协议发现节点按命中的协议声明给下游。四条协议分支（含 `unknown`）都接同一个条件——认不出协议也要按同一套策略兜底。

两个基础节点各自提供一种通用能力：

条件节点的**比较值来源**：

| 比较值来源 | 语义 |
| --- | --- |
| `literal`（默认） | 与规则里写的固定值比较，`in` / `notIn` 按逗号拆成列表 |
| `field` | 与另一个字段的实时取值比较，例如 `request.body.model in logicalModels[*].id`；`in` / `notIn` 取到数组时按成员判定，取到单值时直接比较，取不到值时按空集合处理 |

`model-select` 节点的**取值来源**：

| 取值来源 | 语义 |
| --- | --- |
| `fixed` | 与请求无关，始终使用节点上勾选的逻辑模型列表 |
| `variable` | 读取 `variablePath` 指向字段的取值作为落点：字符串视为单个逻辑模型 id，字符串数组视为逻辑模型 id 列表；取不到值时使用节点上的兜底逻辑模型，兜底列表为空则不产出落点 |

这样做的好处：

- **不枚举模型**：命中判断基于本次运行真正可见的逻辑模型集合（用通配投影 `logicalModels[*].id` 现算），逻辑模型增减时规则自动生效，不需要改图；
- **没有专用节点，也没有预计算字段**：模型直达只是「条件 + 两次逻辑模型选择」的一种拼法，按协议、按租户、按控制输入等策略用同一组基础节点同样能表达。

**保存下来的图就是生效的图**：画布、版本列表与代理运行时读的是同一份 schema（`@common/router/schemas.ts` 的 `WorkflowGraphSchema`），因此「界面看到的那张图」与「真正生效的那张图」不可能有两种解释。

存下的图与内置策略是两回事：图由谁保存就按谁跑。策略菜单只在画布与某个预设逐字相同时才显示该预设名，否则显示「选择策略」——点一下内置策略即换到当前实现，预设从不暗改用户存下的图。

预设策略放在 `@common/router/presets.ts` 的 `ROUTER_POLICY_PRESETS` 中，第一个即默认策略。四个预设都只由基础节点拼成（没有专用节点），UI 侧由 `components/policy-menu.tsx` 呈现：

| 预设 id | 名称 | 拼法 |
| --- | --- | --- |
| `model-direct` | 逻辑模型命中 | 协议发现 + 条件（`request.body.model in logicalModels[*].id`）+ 两次逻辑模型选择 |
| `ua-source-routing` | UA 区分来源 | 遍历 `request.headers` 的头值识别客户端（Cursor / Claude CLI），分流到不同逻辑模型；认不出来回落兜底逻辑模型 |
| `llm-complexity-routing` | LLM 分析请求复杂度 | LLM 节点判断请求复杂度（提示词拼 `request.body` 整体）写进 `route.complexity` + 条件（正则 `[Cc]omplex`）+ 两个固定落点 |
| `script-routing` | JS 脚本处理请求 | 协议发现 + JS 脚本节点按消息数 / 上下文字数 / 工具数算复杂度写进 `route.complexity` + 条件（等于 `complex`）+ 两个固定落点 |

四个预设覆盖四种「判定依据」：请求模型（读上下文）→ 请求头（循环遍历）→ LLM（自然语言判定）→ JS 脚本（确定性计算）。同类型的拼法只留一个，需要变体时在画布上改比多一个菜单项更好用。

读请求体的预设都得先接上协议发现节点：`model-direct` 读 `request.body.model`、`script-routing` 读 `request.body.messages` / `request.body.tools`，这些路径都由协议发现节点按命中的协议声明（§2.3），所以这两张图里都有它。UA 预设读的是 `request.headers`（与协议无关），不需要。`script-routing` 还多一层：消息列表在哪是协议层的事，脚本读 `route.protocol`（协议发现节点写的一手事实）决定读 `request.body.messages` 还是 `request.body.input` —— 「先试 `messages`、取不到再试 `input`」在体里两者都有时会读错那一个（`/v1/responses` 的请求体里可能同时带着这两者）。`llm-complexity-routing` 拼的是 `request.body` **整体**——那是入口节点保证得了的东西（协议无关），所以它也不需要协议发现节点：要精确到消息列表，就自己加一个协议发现节点、把模板改成 `${request.body.messages}`；预设刻意不替用户猜协议，因为 `/v1/responses` 的消息在 `input` 里，猜错就是静默判定成「简单」。

这两条契约都不是靠自觉，而是有回归用例兜着（`pages/router/field-hints.test.ts` 的「内置策略 × 字段候选表」）：用例把每个预设节点真正读的路径抽出来（条件字段与比较字段、变量取值、遍历来源、脚本里的 `get('…')`、提示词里的 `${…}`），要求它必须出现在**该节点自己的候选表**里，候选表口径与面板共用同一份实现（`pages/router/panel/field-candidates.ts`）。图「能跑」和「改得动」是两件事：payload 里本来就有整个请求体，读一条没人声明过的路径照样算得出结果，但用户在脚本编辑器里补全不出来、在条件下拉里选不到，这张图就是死的。同一组用例还有一条「只在某一种协议里存在的请求体字段，预设必须按 `route.protocol` 取舍」：像 `messages` / `input` / `system` / `instructions` 这种只在部分协议里存在的字段，预设只要读了其中一个，就必须显式引用 `route.protocol` 来取舍（`model` / `tools` 这种每种协议都有的不受约束）。

内置脚本预设里那段代码是真的会被跑一遍再断言的（`source/server/proxy/capabilities/script-sandbox.test.ts`）：引擎侧的脚本节点测试都注入假 `runScript`、只能比对代码文本，少了一层就逼不出「换个协议就读错字段」；沙箱本身只依赖 `node:vm`，所以能脱离代理执行栈单独跑。

`ua-source-routing` 用一套「循环体写落点、迭代节点只判定命中」的拼法：

- **循环体负责产出**：循环体末端的 `model-select`（固定值或取 `route.iteration.item.id`）把落点写进 `route.modelIds`，这就是唯一的结果载体；
- **命中判定复用同一路径**：迭代节点的 `collectPath` 直接填 `route.modelIds`，每轮结束读一次，非空即「本轮命中」；`collectMode: 'first'` 表示命中即停止遍历；
- **`resultPath` 留空**：`resultPath` 是「整轮汇总结果」的写回位置。如果把汇总结果本身当作落点，就填 `route.modelIds`；而这个预设要区分「命中」和「没命中」，若同样填 `route.modelIds`，整轮没命中时会用空数组把循环体已经写下的落点覆盖掉，因此留空，让 `route.modelIds` 保持迭代结束时的状态；
- **兜底交给下游**：循环体下游再接一个 `source: 'variable'`、`variablePath: 'route.modelIds'` 的逻辑模型选择节点，命中时它读到循环体写的 id（`matched: true`、不标记回落），没命中时读到空值、走自己的 `fallbackModelIds`（`matched: false`、`route.fallback = true`）。一个节点同时覆盖「命中沿用」和「未命中兜底」，不需要额外条件分支。

它之所以遍历 `request.headers` 而不是直接取 `request.headers.user-agent`：**判定的是头值里出现的客户端标识，不是某个固定头名**。头名大小写、由哪个头携带（`user-agent` / `x-client-name` / 自定义头）都不影响结果，客户端改名或换头也不用改图；代价是兜底分支要负责「一个都没认出来」。

两个复杂度预设的骨架完全一致（判定 → 条件 → 两个固定落点），差别只在「谁来判定」：

- **LLM 节点**：提示词只要求回答一个词，回复自由度高，所以条件用不锚定首尾的**正则匹配** `[Cc]omplex`，兼顾多余空白与首字母大写；代价是每次路由都会多一次模型调用，且判定结果不可完全预期。
- **JS 脚本节点**：返回值是确定的字符串，所以条件用**等于**精确判定；`console.log` 会进 trace 的「控制台」，打分过程可以在测试运行面板里核对；消息列表由 `route.protocol` 决定读 `messages` 还是 `input`；代价是规则要自己维护。

两者的判定结果都写在 `route.complexity`。LLM / 脚本节点失败时该字段读不到值，条件自然走「其余」（简单）分支，判定失败倾向于走便宜模型。想让判定绝对可靠，可以把 LLM 提示词改成「只回答 JSON」，再用脚本节点解析它。

预设里所有落点都不是写死的占位值：`createGraph(models)` 接收当前可见的逻辑模型列表，在生成时就把落点定成真实存在的逻辑模型 id——兜底落点取内建默认逻辑模型（被停用/删掉时退回第一个已启用模型），分流落点按顺序取兜底之外的其他逻辑模型，候选不够时退回兜底落点。这样「套用预设」出来的图直接能跑，不会一上手就报「没有可用逻辑模型」；实在想让两个分支落到同一个逻辑模型，也不会留下一个空落点。一个已启用逻辑模型都没有时（还没配置完的过渡态）落点为空数组，出口节点会照实报「没有可用逻辑模型」。

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
| `string` / `number` / `boolean` / `enum` | 节点声明（输入节点、协议发现节点的声明表）、控制项定义、协议枚举 | 对应类型的子集 |
| `array` | 数组整体字段（`logicalModels`） | `contains` / `notContains` / `empty` / `notEmpty` / `exists` / `equals` / `notEquals` |
| `object` | 对象整体字段（`request.headers` / `request.body` / `metadata`） | `contains`（按键名） / `empty` / `notEmpty` / `exists` / `equals` / `notEquals` |
| `unknown` | 推不出类型：数组元素、未定义字段、动态脚本产出 | **不限制**，全部操作符可选，语义完全交给运行时按实际取值决定 |

运行时语义按**实际取值**判定，不按静态类型：

- `empty` / `notEmpty`：`undefined` / `null` 为空；数组看 `length`；对象看有没有键；字符串看去掉空白后是否为空；
- `contains`：数组比较每个元素（对象元素按结构化序列化比较，便于按内容筛选）；对象比较键名；其余退化成子串包含；
- `equals` / `notEquals`：对象 / 数组先按结构化序列化比较，再退化成字符串比较。

这条「`unknown` 不限制操作符 + 运行时按实际取值决定」的设计，等价于把条件判断当成动态脚本处理：类型只是给 UI 的提示，不是运行时约束。

#### 2.9.1 操作符清单（中文名 / 语义）

面板与节点卡片展示的是下表的中文名，标识符只作为次要信息（`CONDITION_OPERATOR_META`，`source/common/router/types.ts`）。说明文字与引擎判定一一对应：用户读到什么，运行时就得怎么判：

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

### 2.10 运行时接入：代理执行的就是这张图

图不只是一份画布数据，它就是代理的策略本体。代理入口的链路就是这一条：

```text
客户端请求
  └─▶ 入口
        ├─ 认路径：matchProtocolEndpoint(method, path, 客户端形态) 定出协议与封装描述
        ├─ 跑图：resolveRoute() 取当前生效的图 + 逻辑模型列表 → runWorkflow()
        │      └─▶ RouteDecision.modelIds（落点逻辑模型，按优先级排序）
        ├─ 落点 → 候选：planLandingTargets() 逐个落点问规划器要 UpstreamTarget
        │      ※ 上游形态由端点地址 + 客户端跳推出，不回传客户端形态
        └─ 执行：第一个落点有可用候选就交给它，否则换下一个落点
```

要点：

- **落点是列表，不是单个**：出口节点写下的 `route.modelIds` 按优先级排列，规划器从前往后找第一个「已启用且健康、协议匹配」的候选；一个落点全不可用时自动尝试下一个，全部不可用才拒绝请求；
- **拒绝时按入口给信号**：入口回 503 `NO_AVAILABLE_PROVIDER`；选不出落点时回 503 `NO_MODEL_CONFIGURED`，让客户端能区分「没有可用供应商」与「一版图都没保存、或图选不出落点」；
- **手动指定的供应商模型优先**：落点逻辑模型上有人工切换时，该落点的候选直接换成手动指定的 ProviderModel；它不可用时返回 409 `MANUAL_MODEL_UNAVAILABLE`——手动是不愿被绕过的人为选择，静默换一个上游比报错更糟；
- **图存服务端一份**：`workflows` 表 `type = 'router'`，每次保存生成一个递增版本（最多保留 30 版），代理读的永远是「最新保存的那一版」；一版都没保存过时用 `createDefaultPolicyGraph()` 现场生成内建默认策略来跑，于是「开箱可用」与「用户保存的图」走同一段执行路径，不存在第二套写死的规则；
- **画布不做本地缓存**：页头「保存」= 发布新版本，代理立即按它路由；从「历史版本」载入某一版只是拿到编辑起点，不保存就不影响线上行为；
- **版本可以带名字与说明**：保存时弹窗收集的 `name` / `description` 是给这一版写的人类注记，存进 `workflows` 表并展示在历史版本列表里，不参与任何运行时判定；**版本号有自己的字段，不塞进名字里** —— 版本的身份是 `version`（列表里的 `v{n}`），名字不要求唯一，同名多版靠版本号区分，两者都留空就存空串（不会自动填成 `Version N`），内容与最新版一致时不生成版本、这两项也一并丢弃；
- **脚本与提示词节点在主进程执行**：试跑接口与代理入口共用同一份能力集合（`createRouteCapabilities()`：脚本走 `node:vm` 沙箱、提示词走真实上游调用），因此画布上的试跑结果与线上行为一致。

相关实现位置：图存储 `source/server/database/router-graph-store.ts`；路由求解 `source/server/proxy/routing/route-resolver.ts`；落点→候选 `source/server/proxy/routing/landing-planner.ts`；能力集合 `source/server/proxy/capabilities/route-capabilities.ts`。

管理端接口（都挂在管理服务的 `/api/router` 下，图与试跑各一组）：

| 接口 | 用途 |
| --- | --- |
| `POST /router/graph` | 读当前生效的图（一版都没保存过时返回内建默认策略） |
| `POST /router/graph/versions` | 版本摘要列表 |
| `POST /router/graph/version` | 读指定版本 |
| `POST /router/graph/save` | 保存为新版本（内容与最新版一致时不新建） |
| `POST /router/run` | 用给定图试跑一次 |

---

## 3. 图模型与执行模型

节点/边结构、端口语义、控制流、循环与步骤预算都是**引擎契约**，只在 [workflow-engine.md](./workflow-engine.md) 维护。本文不复制其中的类型定义与执行细节，读产品文档时只需要知道三条：

- **节点配置不携带连接信息**：不存在 `next` / `bodyNext` / `elseNext`，控制流全部由 `WorkflowGraph.edges[].sourcePort` 表达；
- **端口名就是语义**：`out`（单出口）、`body`（循环体入口）、`else`（条件未命中）、条件分支的 `case-*`，以及协议分支端口（来自 `WORKFLOW_PROTOCOLS`）；
- **节点类型清单是代码**：`source/common/router/types.ts` 的 `WorkflowNodeKind` 是唯一来源，渲染侧 `source/render/source/pages/router/node-meta.ts` 为每种 kind 提供显示名与图标，执行器按 `kind` 分发。

## 4. 节点目录

路由工作台只保留“路由决策”相关节点；修改请求内容的逻辑属于独立的重写层（见 [request-rewrite-rules.md](./request-rewrite-rules.md)）与协议转换层，不进入路由图执行路径。

节点类型清单以 `source/common/router/types.ts` 的 `WorkflowNodeKind` 为准，共 9 种：

| kind | 面板名称 | 一句话定位 | 详述位置 |
| --- | --- | --- | --- |
| `input` | 输入请求 | 路由起点，提供统一上下文 | §4.1 |
| `condition` | 条件 | IF / ELSE 多分支判定 | §4.2 |
| `model-select` | 逻辑模型选择 | 决定请求落到哪个逻辑模型 | §4.3 |
| `output` | 输出 | 路由终点，交出最终落点 | §4.4 |
| `script` | JS 脚本 | 用一段 JS 把结论算出来写回 payload | §4.5 |
| `prompt` | LLM | 用指定逻辑模型执行提示词并写回 | §4.6 |
| `control-input` | 控制输入 | 注入开关 / 下拉控制值，不改图即可调参 | `ControlInputNode`（`source/common/router/types.ts`） |
| `protocol-discovery` | 协议发现 | 识别请求协议，按协议端口分流，并把该协议下的请求体形状声明给下游（运行时报出协议、形态与按声明读到的请求模型） | `ProtocolDiscoveryNode`（同上） |
| `iteration` | 遍历迭代 | 遍历数组 / 对象，逐项跑循环体 | [workflow-engine.md](./workflow-engine.md) |

### 4.1 Input

核心作用：
- 作为整个路由的入口；
- 接收原始请求；
- 产生统一上下文。

输入：
- `request`（含 `method` / `path` / `headers` / `body`）
- `metadata`（调用方所有，引擎只读）

输出端口 `out`：`payload` 与 `context`。本节点**保证**提供的字段就是下面这些，也是它给出的候选表的全部内容：

| 路径 | 类型 | 说明 |
| --- | --- | --- |
| `request.path` | string | 请求路径 |
| `request.method` | string | 请求方法 |
| `request.headers` | object | 请求头字典（同名头已按 `,` 合并），整体判断用 `empty` / `notEmpty` / `contains` |
| `request.body` | object | 请求体**整体**，体里有什么、什么格式由协议决定 |
| `metadata` | object | 调用方自带的元信息，键名与内容都由调用方定义 |
| `logicalModels`、`logicalModels[*].{id,name,enabled}` | array | 运行时注入的可见逻辑模型列表（含通配投影） |

说明：
- 这是所有后续节点的统一起点；
- **入口节点不解析请求体**：它只保证「有一个体」，不声称体里有哪些字段。`request.body.model` / `messages` / `tools` 这类**协议形状的路径不在它的候选表里**，由协议发现节点在命中的协议分支上声明（声明表在 `source/common/router/request-shape.ts`，渲染侧可直接 import）。同一条规则写在多个协议分支上也不会冲突，候选表按路径去重；
- **运行输出也只有它保证得了的那一条**：本次可见的逻辑模型 id 列表。请求模型不在这里（那是协议层的事实，见 §2.3），运行面板上它显示在协议发现节点下；
- 输入端口可以多，但必须是清晰的上下文对象。

配置体验：
- 面板只读列出上表：每条字段的路径、类型，带说明的再附一句；清单与候选表同源（`pages/router/input-shape.ts`），面板上看到的就是下游能选的。请求体里的字段不在这里，接上协议发现节点后才会出现在下游；
- request / headers / metadata 提供结构化编辑器与字段补全；
- 示例请求只用于**模拟运行**（试跑节点、预览判定结果），不再用来反推候选字段：候选表由节点自己在图上声明，不从某一份示例 payload 里猜；
- 必填字段缺失时在节点上直接标记错误。

---

### 4.2 Condition

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
- 勾选式多选，勾选项去重后写入节点；
- 每行先显示模型名称（右侧等宽显示 id），次行显示模型说明；未配置说明（或说明只有空白）时显示占位文案，避免「这里本来就该有说明」被误读成界面缺了一块；
- 输出结果展示最终 `modelIds`，便于审计和调试；

---

### 4.4 Output

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

### 4.5 脚本节点（Script）

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
- 「插入字段」列的是**上游声明过的全部字段**，不做类型收窄：`get()` 读得动整体对象（`get('request.body')` 是正常写法），把它藏起来只会让人写得出、点不出；
- 结果写回路径提供字段候选表；空源码 / 未配置路径时面板直接给出警告；
- 超时可调，上限与引擎夹取用的是同一个常量（`SCRIPT_TIMEOUT_LIMIT`）。

---

### 4.6 LLM 节点（Prompt）

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
- 下拉下方常驻一条**选型建议**：这类 LLM 决策任务推荐用**上下文窗口大、速度极快的本地小模型**处理——节点几乎每个请求都要跑一次，本地模型延迟更低、不占云端配额，判定质量也够用（文案见 `router.panel.promptModelAdvice`）；
- 系统提示词 / 提示词分别编辑，提示词支持「插入字段」生成 `${路径}`；
- 插值对非标量做 JSON 序列化，所以候选表列的是**上游声明过的全部字段**：`${request.body}` 这类整体字段是正常用法（让模型读整段请求体），不因为它们不是标量就从补全里消失；
- 温度（0–2）、最大回复长度、超时（上限 `PROMPT_TIMEOUT_LIMIT`）可调；
- 回复写回路径提供字段候选表，未配置时给出警告。

---

## 5. 结论

- 路由编排回答的是「这次请求去哪个逻辑模型」，不负责改写请求内容；改写属于重写层（[request-rewrite-rules.md](./request-rewrite-rules.md)）与协议转换层（[protocol-conversion.md](./protocol-conversion.md)），不进入路由图；
- 判定靠 `condition` + 路径取值，落点靠 `model-select`，需要算力时用 `script` / `prompt`，需要遍历时用 `iteration` —— 引擎不内置任何专用语义；
- 「模型直达」也只是基础节点的一种拼法（§2.7），逻辑模型增减时规则自动生效；
- 图就是策略本体：代理执行的就是画布上保存的那张图（§2.10），不存在第二套写死的规则。

> 一句话：根据请求选择最终的逻辑模型，而不是改造请求内容。
