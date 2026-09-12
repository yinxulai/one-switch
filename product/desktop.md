# 桌面端产品形态

## 技术栈

Electron + Node + TypeScript + React/Vite，选型理由与版本要求见 [tech-architecture.md](./tech-architecture.md)。

## 主要入口

### 菜单栏 / 托盘

- **macOS**：菜单栏图标
- **Windows**：系统托盘图标
- **Linux**：系统托盘（P1 完善）

### 菜单快捷区

- 服务运行状态（运行中 / 已暂停 / 异常）
- 启动 / 停止代理
- 打开主界面
- 退出应用

菜单栏 / 托盘只提供上述基础操作，逻辑模型、供应商和监听配置统一在主界面管理。

在 macOS 上关闭主窗口不会退出应用：代理和菜单栏图标继续运行，同时隐藏 Dock 图标；从菜单栏重新打开主界面时恢复 Dock 图标。

### 图标状态

| 颜色 | 含义 |
|------|------|
| 绿色 | 全部正常 |
| 黄色 | 部分降级（部分供应商冷却或禁用） |
| 红色 | 全部不可用 |

## 控制台页面

侧边栏分组与页面清单以 `source/render/source/components/app-sidebar.tsx` 为准：

| 分组 | 页面 | 说明 |
|------|------|------|
| 主要 | 智能路由 | 路由工作台：编辑代理实际执行的那张节点图，页头可套用策略预设或载入历史版本 |
| 主要 | 逻辑模型 | 每个逻辑模型的自动切换候选列表 |
| 主要 | 模型管理 | Provider 与 ProviderModel 的增删改、端点绑定、连通性测试 |
| 数据 | 统计分析 | 请求量、成功率、耗时分布、token 趋势，可按时间范围与单个供应商下钻 |
| 数据 | 请求记录 | 请求级与尝试级明细，含客户端/上游正文对比 |
| 高级 | 请求重写 | 可复用重写规则的集中管理，见 [request-rewrite-rules.md](./request-rewrite-rules.md) |
| 系统 | 接入配置 | 本地 Base URL 与各协议接入地址的展示与快捷复制 |
| 系统 | 运行日志 | 应用运行时日志（`runtime_logs`） |
| 系统 | 设置 | 监听、自启、出站代理、日志与数据维护 |

### 逻辑模型页

管理每个逻辑模型的自动切换候选列表，每个列表项是一个 ProviderModel：

- 模型列表（协议类型、远端 URL、Provider API 模型名、Provider、优先级、启用状态、ProviderModel 健康状态）
- **当前使用标识**：高亮显示当前正在使用的列表项
- 新增 / 编辑 / 删除列表项
- 拖拽调整候选顺序（优先级）
- 顶部指标卡汇总该逻辑模型的关键指标（请求成功率、平均响应耗时等）

> v0.3 MVP 只有一个名为 `default` 的兜底逻辑模型和一个全局 ProviderModel 候选池。所有未匹配的非空客户端模型名都由它处理。多逻辑模型及独立候选池属于后续版本；当前 UI 不提供逻辑模型增删改。详见 [data-model.md](./data-model.md) 与 [roadmap.md](./roadmap.md)。

### 模型管理页

- Provider 列表（名称、状态、连续失败、冷却状态）
- 新增 / 编辑 / 删除 / 启用禁用 Provider，并管理其下的 ProviderModel 与端点绑定
- 配置空闲超时时间（两次数据间隔，流式不超时）
- 连通性测试：复用真实模型请求链路验证密钥与端点
- 导入 / 导出供应商包：单个供应商详情可导出，列表页可导入或导出全部；导入前展示包内供应商、将被覆盖的同名供应商数量和明文 API Key 条数，详见 [provider-model.md](./provider-model.md)

### 请求记录页

- 最近请求列表（时间、逻辑模型、协议、最终供应商、状态码、耗时）
- 查看某次请求的详细尝试过程（每个候选 ProviderModel 的结果）
- 查看完整客户端请求/响应和每次 Provider 尝试内容
- 有协议转换时查看转换前后的请求/响应内容
- 使用抽屉或对话框打开详情，支持格式化、复制和折叠
- 筛选：按模型、协议、供应商、状态、时间范围
- 日志字段、采集开关与保留策略见 [observability.md](./observability.md) 与 [data-model.md](./data-model.md)

### 设置页

- 监听地址与端口
- 开机自启
- 上游出站代理（三态模式、绕过规则与连接测试见 [outbound-proxy.md](./outbound-proxy.md)）
- 日志保留天数与「按天数立即清理」
- 关于

### 智能路由（路由工作台）

节点图的编辑与试跑。产品口径、节点设计与默认策略见 [route-design.md](./route-design.md)；图模型、控制流与持久化见 [workflow-engine.md](./workflow-engine.md)。

## 用户流程

### 首次使用

1. 启动应用，菜单栏/托盘出现图标
2. 引导添加第一个 Provider（名称、API Key、超时）
3. 在逻辑模型页添加模型（选择协议、填入远端 URL 和 Provider API 模型名、选择 Provider）
4. 可继续添加多个模型，拖拽调整顺序
5. 一键复制本地 Base URL
6. 在 AI 工具中配置 Base URL；`model` 可保留工具原有的任意非空值，代理会通过 `default` 逻辑模型处理，并在转发时替换为当前 ProviderModel 的 `modelName`
7. 发送测试请求，控制台显示尝试过程和切换路径

### 日常使用

1. 应用在后台运行，可选开机自启
2. 菜单栏图标颜色反映整体健康状态
3. 临时禁用某个供应商或调整优先级
4. 查看请求日志了解每次请求经过了哪些供应商、在哪里失败、最终由谁成功

## 路由与工作台

路由工作台是代理策略本体的编辑入口：请求怎么被识别、怎么判定、落到哪个逻辑模型，全部表达为一张节点图，而代理运行时执行的就是这张图。这些内容各自只有一个权威落点，本文不再重复：

- **产品语义**（`route` 输出契约、路径取值与比较操作符、默认「模型直达」策略、四个策略预设）：见 [route-design.md](./route-design.md) §2
- **引擎与图模型**（节点/边结构、控制流与端口、迭代、脚本与 LLM 能力注入、图的加载与保存）：见 [workflow-engine.md](./workflow-engine.md)
- **画布交互与节点面板**：见 [route-workbench.md](./route-workbench.md)

> **此处曾有一版「最少通用节点」方案，已废弃。** 该方案主张 `input + control-input + condition + model-select + output` 五节点覆盖全部路由能力，并额外设计 `channelProfiles` / `modelRoutingPolicy` 渠道注册表。其中「不再扩展更多专用节点」的判断与实现不符——迭代、脚本、LLM、协议发现节点都已落地；`channelProfiles` / `modelRoutingPolicy` / `enableLlmRouting` / `llmRouterModelId` 这套注册表方案没有被实现；`matchedRuleId` / `matchedRuleType` / `selectedModelIds` / `llmDecision` / `controlSnapshot` 等运行时字段也不存在于请求日志模型中。实际契约以 `source/common/router/types.ts` 与 `source/server/database/schema.ts` 为准。
