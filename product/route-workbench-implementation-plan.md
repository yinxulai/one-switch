# 路由工作台落地实现文档

## 1. 背景与总策略

### 1.1 现状

当前 One Switch 已经拥有一套可运行的路由工作台原型：

- React Flow 画布已接入；
- 自定义节点可展示类型、描述、状态；
- 条件节点支持多个 case / ELSE 分支端口；
- 边删除和图同步已接通；
- 运行前存在图校验；
- 路由测试已具备基础链路验证。

但现状仍处于“功能可用”阶段，而不是“Dify 风格的工程化节点编辑器”。目前核心问题是：

- 节点视觉结构仍集中在一个大组件中；
- 右侧节点配置仍采用 Drawer，不是画布内固定 panel；
- handle 只负责连线，不支持点击插入节点；
- 边和 connection line 还没有 Dify 风格的视觉语义；
- 节点编辑交互和画布层呈现未形成统一分层。

### 1.2 目标

本文档的目标是把现有工作台升级为“可持续维护”的 Dify 级节点编辑器，并尽量满足：

- 高保真复刻“节点编辑”体验；
- 保持 One Switch 现有路由模型和图执行语义；
- 不复制 Dify 的全量平台体系和复杂模块；
- 在实现过程中优先保证功能稳定和测试可回归。

### 1.3 参考实现来源

视觉与交互一律以本地 Dify 仓库为准，不再凭印象“重画”：

- 仓库路径：`C:\Users\Yinxulai\Documents\Github\dify\web`
- 参考版本：`dify-web@1.17.0`（内部图库为 `reactflow@11.11.4`）
- 核心目录：`app/components/workflow/`

| 目标能力 | Dify 参考文件 |
| --- | --- |
| 画布总入口 / 布局 | `app/components/workflow/index.tsx` |
| 节点统一外壳 | `app/components/workflow/nodes/_base/node.tsx` |
| 节点分区（标题 / 描述 / body） | `app/components/workflow/nodes/_base/node-sections.tsx` |
| 节点外壳辅助逻辑 | `app/components/workflow/nodes/_base/node.helpers.tsx`、`use-node-resize-observer.ts` |
| handle + 点击插入节点 | `app/components/workflow/nodes/_base/components/node-handle.tsx` |
| 节点操作栏 | `app/components/workflow/nodes/_base/components/node-control.tsx` |
| 节点缩放 | `app/components/workflow/nodes/_base/components/node-resizer.tsx` |
| 自定义边 | `app/components/workflow/custom-edge.tsx`、`custom-edge-linear-gradient-render.tsx` |
| 自定义连接线 | `app/components/workflow/custom-connection-line.tsx` |
| 边配色 / 连线工具 | `app/components/workflow/utils/edge.ts` |
| 边右键菜单 | `app/components/workflow/edge-contextmenu.tsx` |
| 节点选择器 | `app/components/workflow/block-selector/index.tsx`、`blocks.tsx`、`block-selector-row.tsx`、`constants.tsx` |
| 可选节点过滤 | `app/components/workflow/hooks/use-available-blocks.ts` |
| 右侧配置 panel | `app/components/workflow/panel/index.tsx`、`panel/panel-width.ts` |
| panel 内容组织参考 | `app/components/workflow/nodes/llm/panel.tsx`、`nodes/if-else/panel.tsx` |
| 条件分支节点 | `app/components/workflow/nodes/if-else/node.tsx`、`components/condition-wrap.tsx`、`components/condition-list/` |
| 节点样式与 CSS 变量 | `app/components/workflow/style.css` |

### 1.4 总策略：复制 + 调整

本次不再“看完样式自己实现”，而是明确采用 **复制 + 调整（copy + adapt）** 路线：

- **复制**：按文件从 Dify 复制 JSX 结构、className、handler 骨架、CSS 变量与布局层级；
- **调整**：只改造成 One Switch 能编译、能接业务数据的部分（依赖、UI 基础组件、节点类型、文案、状态来源）；
- **不做**：不重写视觉、不按个人习惯改写结构、不提前抽象、不新增依赖。

判断标准：

1. 复制完成、仅做必要适配后，节点外观应与 Dify 实际运行效果基本一致；
2. 出现差异时，先怀疑“我们改多了”，而不是“Dify 写得不对”；
3. 只有当 Dify 的实现依赖 One Switch 不具备的系统能力（协作、插件、多租户、DSL、运行引擎）时才允许重构。

单个文件的复制节奏固定为五步：

1. 原样复制到目标路径；
2. 替换 import 与基础组件依赖，先让类型检查通过；
3. 用静态数据渲染，肉眼比对视觉；
4. 接上 One Switch 的节点类型与业务数据；
5. 补测试并回归。

### 1.5 关键差异与适配清单

| 差异点 | Dify | One Switch | 调整方式 |
| --- | --- | --- | --- |
| 图库 | `reactflow@11` | `@xyflow/react@12` | import 全部改为 `@xyflow/react`；按 v12 调整 `NodeProps` / `EdgeProps` / `useStore` / `Handle` 用法 |
| UI 基础组件 | `@langgenius/dify-ui/*` | `components/ui/*`（shadcn 风格） | 建立映射关系；缺失组件先写最小实现，不引入新依赖 |
| 样式体系 | Tailwind + `workflow/style.css` 语义变量 | Tailwind v4 + 主题变量 | 复制 CSS 变量定义，按 One Switch 主题重映射明度阶梯 |
| i18n | `react-i18next` + `t()` | 中文文案直接写在组件内 | 去掉 `t()`，替换为中文常量 |
| 状态管理 | zustand 全量 workflow store / hooks-store | 页面 state + 现有 `graph` 模型 | 用 props / 局部 state 注入，不引入 Dify store |
| 节点类型 | `BlockEnum`（数十种） | input / condition / model-selector / output / control-input | 只保留映射到本项目的分支 |
| 工具库 | `es-toolkit`、`ahooks`、`jotai` | `date-fns`、`zustand` 等 | 用原生实现或现有依赖替代，不新增依赖 |
| 运行状态来源 | `NodeRunningStatus` + Dify 运行引擎 | 现有 `engine.ts` / 图校验 | 复用同名状态枚举，只替换数据来源 |

---

## 2. 实施目标

### 2.1 功能目标

1. 节点采用统一结构：封装节点外壳 + 业务内容 + 右侧配置 panel。
2. handle 支持点击插入节点和拖拽连线两种交互。
3. 节点配置改为右侧固定 panel，布局更接近 Dify。
4. 条件节点展现 IF / ELIF / ELSE 分支结构和独立出口。
5. 自定义 edge 和 connection line 提升可视化质量。
6. 保持图数据、连接规则、路由校验和测试逻辑一致。

### 2.2 设计目标

1. 以“层级化节点编辑器”取代“单文件大组件”模式；
2. 优先采用背景明度区分层级，而非大量阴影和边框；
3. 采纳 Dify 的交互范式，但保持 One Switch 的 UI 稳定性和产品调性；
4. 不引入 Dify 的全量平台能力，如插件安装、授权、协作 presence 等；
5. 视觉实现以“复制 Dify 源码 + 最小适配”为准，而不是重新设计；
6. 每个组件都能指回具体的 Dify 源文件，找不到出处的自有实现需要重新评估。

---

## 3. 范围与边界

### 3.1 本次范围

- 节点外壳和状态结构重构；
- handle 交互重构；
- 节点选择器补齐；
- 右侧配置 panel 改造；
- 自定义 edge / custom connection line；
- 条件分支视觉重排；
- 路由图功能回归测试。

### 3.2 非本次范围

- Dify 全量 workflow store；
- 协作 presence / 用户光标；
- plugin 安装、读我页和授权中心；
- 迭代器 / loop 容器节点的复杂布局；
- Dify 的完整历史记录、版本共存和脚本操作；
- 所有与路由图无直接关系的后台/插件生态能力。

---

## 4. 目标架构

建议采用 Dify 的“统一外壳 + 业务 body + 统一 panel”结构，但只保留本项目需要的最小功能。

```text
source/render/source/pages/router/
├── page.tsx                     // 画布总入口和布局
├── node-registry.ts            // NodeComponentMap / PanelComponentMap
├── components/
│   ├── workflow-node.tsx       // BaseNode
│   ├── workflow-node-panel.tsx // BasePanel
│   ├── workflow-edge.tsx       // CustomEdge
│   ├── workflow-connection-line.tsx
│   ├── node-handle.tsx
│   ├── node-selector.tsx
│   └── node-action-bar.tsx
├── nodes/
│   ├── input-node.tsx
│   ├── condition-node.tsx
│   ├── model-selector-node.tsx
│   ├── output-node.tsx
│   └── control-input-node.tsx
├── panel/
│   ├── input-panel.tsx
│   ├── condition-panel.tsx
│   ├── model-selector-panel.tsx
│   └── output-panel.tsx
├── types.ts
├── schemas.ts
├── engine.ts
└── engine.test.ts
```

### 4.1 组件职责分离

- `workflow-node.tsx`
  - 统一节点外壳；
  - 提供选中、运行状态、标题行、图标区域；
  - 负责挂载公共 handle 和公共操作栏。

- `condition-node.tsx`
  - 只负责 IF / ELIF / ELSE 的体感布局和摘要内容；
  - 不接管表单配置。

- `workflow-node-panel.tsx`
  - 统一右侧配置容器；
  - 负责标题、描述、Tabs、关闭、Resize；
  - 业务内容由对应 panel component 驱动。

- `workflow-edge.tsx`
  - 自定义边的曲线、hover、状态和 selector。 

- `node-selector.tsx`
  - 负责端口点击和边中间挂载的新增节点选择器。

### 4.2 目标文件 ↔ Dify 源文件映射

所有目标文件都需要标注其 Dify 出处，便于后续同步上游改动：

| One Switch 目标文件 | 复制自 Dify |
| --- | --- |
| `components/workflow-node.tsx` | `nodes/_base/node.tsx` + `node-sections.tsx` |
| `components/node-handle.tsx` | `nodes/_base/components/node-handle.tsx` |
| `components/node-action-bar.tsx` | `nodes/_base/components/node-control.tsx` |
| `components/node-selector.tsx` | `block-selector/index.tsx` + `blocks.tsx` + `block-selector-row.tsx` |
| `components/workflow-node-panel.tsx` | `panel/index.tsx` + `nodes/llm/panel.tsx` 的结构 |
| `components/workflow-edge.tsx` | `custom-edge.tsx` |
| `components/workflow-connection-line.tsx` | `custom-connection-line.tsx` |
| `nodes/condition-node.tsx` | `nodes/if-else/node.tsx` + `components/condition-wrap.tsx` |
| `panel/condition-panel.tsx` | `nodes/if-else/panel.tsx` + `components/condition-list/` |
| 主题 CSS 变量 | `style.css` |
| 画布 + panel 布局 | `index.tsx` 的布局部分 |

不在此表中的文件（`types.ts` / `schemas.ts` / `engine.ts` 等）属于 One Switch 既有业务层，不复制、不改语义。

---

## 5. 实施步骤

### Phase 1：拆层节点架构

#### 目标

在不改变业务数据模型的前提下，用 Dify 的 `BaseNode` 结构替换当前单文件节点组件。

#### 参考源（复制自 Dify）

- `nodes/_base/node.tsx` — BaseNode 外壳；
- `nodes/_base/node-sections.tsx` — `NodeHeaderMeta` / `NodeDescription` / `NodeBody`；
- `nodes/_base/node.helpers.tsx`、`use-node-resize-observer.ts` — 状态边框与尺寸观察；
- `nodes/_base/components/node-control.tsx`、`node-resizer.tsx` — 操作栏与缩放。

#### 任务

1. 新增 `node-registry.ts`，建立 `NodeComponentMap` 与 `PanelComponentMap`。
2. 复制 `_base/node.tsx` 为 `workflow-node.tsx`，保留其 DOM 层级与 className 命名方式。
3. 复制 `node-sections.tsx` 的分区结构，作为节点标题 / 描述 / body 的公共三件套。
4. 把当前 `WorkflowFlowNode` 中的标题、描述、状态、端口容器换成上述公共组件。
5. 让所有节点通过 `registry` 挂载 body，而不是在一个大组件中硬编码。
6. 保持现有 `graph`、`edges`、`sourcePort` / `targetPort` 语义不变。

#### 适配点

- 去掉 `useCollaboration`、`useNodePluginInstallation`、`CopyID` 等 One Switch 不具备的能力；
- 去掉 `t()` i18n，改为中文常量；
- `data._connectedTargetHandleIds` 等 Dify 内部字段用 One Switch 图数据等价推导，不改图模型。

#### 验收标准

- 当前路由图仍能正常渲染；
- 节点功能与原来一致；
- 代码结构已经从单文件大组件拆分出来；
- 之后每种节点类型都可单独替换视觉，并不影响其他节点。

---

### Phase 2：重做 handle 与节点插入交互

#### 目标

实现 Dify 式端口：可拖拽，也可点击插入节点。

#### 参考源（复制自 Dify）

- `nodes/_base/components/node-handle.tsx` — `NodeSourceHandle` / `NodeTargetHandle`（含 `handleHandleClick` + `handleSelect`）；
- `block-selector/index.tsx`、`blocks.tsx`、`block-selector-row.tsx`、`constants.tsx` — 节点选择器；
- `hooks/use-available-blocks.ts` — 可选节点过滤；
- `custom-edge.tsx` 中 `EdgeLabelRenderer` + selector 的挂载方式。

#### 任务

1. 统一改造节点 handle：
   - hit area 进一步放大；
   - 可见样式从圆点改成短竖线；
   - hover/selected 时显示增强状态。
2. 节点 `sourceHandle` / `targetHandle` 支持 click 打开 selector。
3. 复用现有 `handleConnect` 与 `handleEdgesDelete` 逻辑。
4. selector 只加载 One Switch 的路由节点类型，不引入 Dify 全量 block 列表。
5. 支持从 source handle 或边中间插入子节点，保持 `sourcePort` / `targetPort` 正确写入。

#### 适配点

- `useAvailableBlocks` 的入参从 `BlockEnum` 改为本项目节点类型，只保留可用/不可用判断；
- `handleNodeAdd` 替换为现有图的加节点逻辑，不引入 Dify store；
- selector 内部去掉插件市场、工具、触发器 tabs，只保留一个平铺列表。

#### 验收标准

- 可拖拽连线；
- 可点击端口打开节点选择器；
- 新增节点能自动生成正确边和端口；
- 运行前图校验不因插入操作出问题；
- 测试仍通过。

---

### Phase 3：重构右侧节点配置面板

#### 目标

把当前 Drawer 改为画布右侧非模态固定 panel。

#### 参考源（复制自 Dify）

- `panel/index.tsx` — panel 容器与画布协同；
- `panel/panel-width.ts` — 宽度约束；
- `nodes/llm/panel.tsx`、`nodes/if-else/panel.tsx` — 标题 / 描述 / 表单区组织；
- `nodes/_base/components/node-resizer.tsx` — 宽度拖拽实现。

#### 任务

1. 新增 `workflow-node-panel.tsx`，统一 panel 容器；
2. 复制 panel 的标题、关闭按钮、描述、表单区结构，拆成组件化结构；
3. 让 panel 支持 resize，并复用 Dify 的宽度上下限；
4. 保持 node selection 与 panel 绑定；
5. 对现有 node 配置表单做结构性迁移，而不是重写业务配置逻辑。

#### 适配点

- panel 内部表单直接搬现有 One Switch 表单，不换控件库；
- 去掉 panel 的 Tabs/调试/评论/版本历史等 Dify 专属分区；
- 不引入 Dify 的全局 store，选中节点由页面 state 传入。

#### 验收标准

- 画布仍然可见，并且右侧 panel 不覆盖整块页面；
- 节点切换时 panel 内容同步切换；
- 不引入过大的布局破坏；
- 对用户而言，编辑节点仍然是“在画布旁进行配置”。

---

### Phase 4：实现自定义 edge 与条件分支视觉

#### 目标

让工作台具备 Dify 风格的边和条件节点表达。

#### 参考源（复制自 Dify）

- `custom-edge.tsx` — bezier 曲线、hover 高亮、中间插入入口；
- `custom-connection-line.tsx` — 拖拽中的连接线；
- `custom-edge-linear-gradient-render.tsx`、`utils/edge.ts` — 渐变与配色；
- `edge-contextmenu.tsx` — 边上的操作菜单；
- `nodes/if-else/node.tsx`、`components/condition-wrap.tsx`、`components/condition-list/` — 条件分支布局；
- `style.css` — workflow 语义 CSS 变量。

#### 任务

1. 复制 `custom-edge.tsx` 为 `workflow-edge.tsx`，包括 `getBezierPath` 参数；
2. 跟踪边 hover 时显示 selector 和加号入口；
3. 根据运行状态设置边颜色/渐变；
4. `condition-node.tsx` 按 `if-else/node.tsx` 的分支摘要布局重建；
5. IF / ELIF / ELSE 的 handle 与文本对齐；
6. `output` / `selected` / `running` status 维持一致性。

#### 适配点

- `getEdgeColor` 的输入从 Dify 状态枚举映射到本项目状态；
- 去掉 `ErrorHandleTypeEnum`、嵌套节点（iteration / loop）相关分支；
- `style.css` 的变量名按 One Switch 主题重映射，保留原有层级关系。

#### 验收标准

- 不同状态的 edge 可识别；
- 条件节点看起来像真实分支编辑器；
- 用户可从边上直接继续插入节点；
- 画布整体视觉与 Dify 更接近，但不依赖 Dify 组件库全部实现。

---

### Phase 5：回归与收口

#### 目标

确保功能和测试保持稳定。

#### 任务

1. 执行路由相关测试；
2. 检查 `handleConnect`、`handleEdgesDelete`、`buildFlowEdges` 与 `graph` 同步；
3. 检查输入节点和输出节点保护逻辑；
4. 校验多分支端口是否依旧可编辑；
5. 再次确认 UI 权衡：不引入不必要的阴影和边框；
6. 逐个新组件对照其 Dify 源文件，确认“视觉差异 = 已知适配点”，而不是实现走样。

#### 验收标准

- 路由测试通过；
- 节点编辑逻辑不回退；
- UI 层视觉升级不破坏功能；
- 每个复制来的组件都能说明自己与 Dify 源实现差在哪里。

---

## 6. 实施原则

### 6.1 复制 + 调整原则

参考实现固定在 `C:\Users\Yinxulai\Documents\Github\dify\web`。本项目不复制 Dify 的所有平台能力，而是复制其“节点编辑器”的关键实现：

- 统一节点外壳；
- 统一 panel；
- 条件节点分支化；
- handle 可点击插入；
- 边支持中间插入；
- 节点基础状态表达。

落地时每个组件都走同一节奏：**复制 → 编译 → 视觉比对 → 接数据 → 回归**。出现视觉差异时，先回 Dify 源码找原因，而不是直接改样式；只有被判定为“必需适配”的差异，才允许偏离源实现。

### 6.2 功能优先原则

在 UI 改进前，必须确保图模型、连接规则和图执行逻辑保持稳定。

### 6.3 低风险迭代原则

每个 phase 都应该可独立提交和回归，避免一次性重写所有节点逻辑。

---

## 7. 风险与应对

### 风险 1：图数据结构不匹配 UI 结构

风险：节点扩展时端口和 handle 绑定错误，导致旧图无法渲染。

应对：保持 `sourcePort` / `targetPort` 语义和图 schema 稳定，优先在 UI 组件层做兼容处理。

### 风险 2：右侧 panel 尺寸与布局不协调

风险：panel 太宽或太窄，导致画布区域被压缩严重。

应对：设定最小画布保留宽度，确保 panel width 与 canvas 可见范围保持平衡。

### 风险 3：边与节点交互冲突

风险：handle click 和拖拽连线、node click 同时触发。

应对：在事件传播中增加 `stopPropagation`，并保证 selector open 状态和 connection logic 分离。

### 风险 4：Dify 视觉带来的样式偏差

风险：直接照搬阴影和边框，违背 One Switch 的设计偏好。

应对：保留 Dify 的空间层次和交互逻辑，但用颜色明度和状态 ring 代替炫目阴影与边框。

### 风险 5：复制后越改越散

风险：Dify 组件依赖其内部 store、hooks 和 DSL，适配过程中容易把内部实现互相搬进来，最终变成迷你版 Dify。

应对：只复制展示层；业务数据一律由 props 注入；单个组件不得引入 Dify 的 store / 请求 / 运行引擎。

### 风险 6：图库版本差异

风险：Dify 用 `reactflow@11`，One Switch 用 `@xyflow/react@12`，`Handle` / `NodeProps` / `useStore` 等 API 不一致，出现“代码一样但跑不起来”。

应对：复制后第一步就是统一 import 到 `@xyflow/react`，先用最小 demo 验证 handle / edge API，再搬业务。

### 风险 7：许可与归属

风险：Dify 采用修改版 Apache-2.0（附带多租户与前端 LOGO / 版权保留条件），直接搬运前端资源存在合规风险。

应对：仅复制节点编辑器的结构与交互实现，不搬运 Dify 品牌、LOGO、文案与图标资源；必要处保留归属说明。

---

## 8. 预计交付物

本次升级的最终结果将包括：

- 一套 Dify 风格但适配 One Switch 的节点外壳与 body 结构；
- 可点击插入的 source / target handle；
- 可调整宽度的右侧配置 panel；
- 更清晰的条件节点和 custom edge；
- 通过图回归测试的路由工作台；
- 一份“目标文件 ↔ Dify 源文件”映射基线，便于后续同步上游改动；
- 形成一套可持续维护的节点编辑器组件结构。

---

## 9. 结论

本次落地的重点不是“参考 Dify 重新设计”，而是 **从 Dify 复制实现、只做必要调整**：

- 参考代码固定在 `C:\Users\Yinxulai\Documents\Github\dify\web`；
- 统一结构、交互、面板与画布协同、条件分支可视化、编辑器体验全部沿用源实现；
- 差异只发生在依赖、数据源、文案与主题变量这四类适配点上。

基于当前 One Switch 的业务成熟度，最稳妥的方式是：

1. 先复制节点外壳并拆层；
2. 再复制 handle 与 selector；
3. 再复制 panel 结构；
4. 最后复制 edge 与条件节点视觉；
5. 最终以回归测试收口。

这是一条低风险、高收益的落地路径：既能拿到 Dify 的节点编辑体验，又能保住今天路由图的功能稳定性。
