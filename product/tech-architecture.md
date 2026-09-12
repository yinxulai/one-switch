# 技术架构与框架选型

> **状态说明：本文描述 v0.3 当前实现与明确的后续边界。** 数据库、关系模型、核心路由、请求观测、管理 API、协议适配器和渲染层分域已经落地；请求链路字段严格区分 `client*`、`upstream*` 与配置实体的 `provider*`。OpenAPI 文档与代码生成尚未接入，不作为当前实现依赖；发布包端到端验证以 `roadmap.md` 的剩余发布验收项为准。

## 整体技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 桌面壳 | Electron | 跨平台桌面应用 |
| 构建工具 | Vite | 主进程 / 预加载 / 渲染进程统一构建 |
| 主进程 | TypeScript + 原生 Node `http` | 独立的代理服务与管理服务，不引入 HTTP 框架 |
| 代理透传 | 原生 `http.request` + 手动 pipe | 流式可控、依赖最少 |
| Schema 定义 | Zod | 运行时类型校验、配置声明、API 请求/响应验证 |
| API 规范 | Zod Schema + 源码路由注册表 | 当前管理契约由 `source/common/schemas.ts` 与 `source/server/management/router.ts` 实现；OpenAPI 尚未接入 |
| 代码生成 | 未使用 | Render API client 为 `source/render/source/api/client.ts` 中的手写轻量 fetch 封装 |
| 本地存储 | SQLite（`node:sqlite` + Drizzle ORM）+ 系统密钥环 | 配置和日志存 SQLite，密钥存 keychain |
| 数据库迁移 | 单一首发基线 + 发布后版本迁移 | 首发结构干净，发布后升级可追踪 |
| 渲染进程 | React 18 + TypeScript | 控制台 UI |
| UI 组件 | shadcn/ui + Tailwind CSS | 现代、可定制、体积小 |
| 状态管理 | 轻量外部 Store + React hooks | 共享应用状态、缓存和轮询 |

## 关键技术决策

### 为什么不用 HTTP 框架

代理服务和管理服务各自使用一个原生 `http.createServer` 实例，不引入 Hono/Fastify/Express：

- 管理 API 端点不多（配置 CRUD、日志、健康状态、路由工作台、重写规则），原生路由足够
- 代理透传层需要完全掌控请求/响应流，框架反而增加抽象成本
- 两个监听器共享应用级数据库和密钥存储，但生命周期独立；停止或重启代理不会中断管理 API
- 减少依赖，降低打包体积和安全面
- 代理服务是纯 Node 模块，Electron 只是宿主，未来可抽 CLI / 无头模式

### 为什么用 Zod 做 Schema

- **单一真相源**：配置模型、API 请求/响应、数据库行都用 Zod schema 定义，TypeScript 类型从中推导
- **运行时校验**：管理 API 的入参出参、供应商包导入导出、数据库读写都在边界处校验，保证数据一致性
- **边界明确**：当前使用 Zod 做运行时校验和共享契约；未来若接入 OpenAPI，必须以现有 Schema/路由为基础，不能反向虚构已生成的类型或接口文件
- **零依赖膨胀**：Zod 体积小，不引入额外运行时

### 为什么用统一 POST 风格 API

管理 API 全部使用 POST 方法，路径格式为 `/api/资源/动作`，不依赖 HTTP 方法和状态码语义。以下是 v0.3 当前契约；旧版 `/api/upstream-model/*` 路径已删除，不提供兼容别名。实际注册路由以 `source/server/management/router.ts` 为准：

- **简单一致**：前端调用统一用 POST，不需要区分 GET/POST/PUT/DELETE，不需要处理不同状态码
- **结构化错误**：错误通过 body 中的 `success`、`errorCode`、`errorMessage` 表达，类型安全，前端可统一处理
- **便于调试**：所有请求都有 body，日志和抓包一目了然
- **避免歧义**：HTTP 状态码只表示网络层是否成功，业务结果完全由 body 决定
- **控制动作明确**：启动、停止、重启代理等管理操作可直接表达为 `/api/proxy/动作`

### OpenAPI 的当前边界

OpenAPI 目前未接入，项目没有 OpenAPI 文档、生成类型或 `openapi-typescript` 依赖。当前契约由 Zod Schema、管理路由注册表和 Render 的手写 API client 共同构成。未来如确有 CLI 或第三方集成需求，再单独引入 OpenAPI，并补充生成与一致性验证。
### 为什么用 SQLite 替代 JSON/JSONL

- **查询能力**：日志筛选、分页、统计用 SQL 比遍历 JSONL 高效得多
- **事务一致性**：配置变更（如删除 Provider 级联禁用 Provider 模型）用事务保证原子性
- **迁移可控**：首发前只保留最终基线，首发后冻结基线并追加事务化版本迁移
- **单文件部署**：SQLite 是单个文件，和 JSON 一样便携，备份/供应商包导入导出都方便
- **Drizzle ORM**：提供类型安全的同步数据访问，SQLite 查询集中在 database store 边界；基于 Node 22.5+ 内置 `node:sqlite`，零原生依赖、无 ABI 问题

## 项目结构

```
one-switch/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── product/                      # 产品规格文档
├── source/
│   ├── server/                     # 核心主体：runtime + management + proxy + database
│   │   ├── index.ts                # 外部生命周期入口
│   │   ├── runtime/server-runtime.ts # ServerRuntime 启动/停止编排
│   │   ├── management/             # 管理 HTTP 服务，routes/ 下按域分组注册
│   │   ├── proxy/                  # 分层代理链路，见 proxy-engine.md
│   │   ├── database/               # SQLite + Drizzle 持久化层及按领域拆分的 *-store.ts
│   │   ├── infrastructure/secrets/ # 系统密钥环适配
│   │   └── security/               # Host validation
│   │
│   ├── command/                    # Electron 主进程、预加载与命令入口
│   │   ├── index.ts                # Electron 应用编排
│   │   ├── preload.ts              # 暴露最小化 API 给渲染进程
│   │   ├── auto-launch.ts          # 开机自启
│   │   ├── tray-manager.ts         # 菜单栏/托盘管理
│   │   └── secret-store.ts         # 系统密钥环封装
│   │
│   ├── common/                     # server / command / render 共享
│   │   ├── schemas.ts              # Zod schema（可被 server、command 和 render 引用）
│   │
│   └── render/                     # UI 入口：React 渲染进程
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/                    # client.ts + 按领域 API modules
│       ├── features/               # Provider、Proxy、Health、Settings、Logical Models
│       ├── infrastructure/         # polling-manager、deep-equal
│       ├── store/                  # create-store
│       ├── components/             # shadcn/ui 组件 + 业务组件
│       ├── pages/                  # 按页面目录组织的 page、service、hooks
│       └── services/               # 通用 use-async
│
└── resources/                      # 静态资源：图标、托盘图标等
```

## 模块地图

模块职责只在这里定位，细节各有权威文档，不再逐文件重述：

| 模块 | 职责 | 权威文档 |
| --- | --- | --- |
| `source/server/runtime` | 进程级组装与生命周期：启动/停止 management 与 proxy，失败回滚 | [server-architecture.md](./server-architecture.md) |
| `source/server/management` | 配置管理与管理 API（含路由工作台、重写规则、诊断） | [server-architecture.md](./server-architecture.md) |
| `source/server/proxy` | 代理请求链路：入口、路由、规划、执行、协议、修饰、观测 | [proxy-engine.md](./proxy-engine.md) |
| `source/server/database` | SQLite + Drizzle 持久化层与按域拆分的 `*-store.ts` | [data-model.md](./data-model.md) |
| `source/server/infrastructure`、`source/server/security` | 密钥环适配、Host 校验 | [security-privacy.md](./security-privacy.md) |
| `source/common` | server / command / render 共享契约（Zod schema、协议表、路由类型） | 各自主题文档 |
| `source/command` | Electron 主进程：窗口、托盘、开机自启、自动更新、密钥存储 | [desktop.md](./desktop.md) |
| `source/render` | React 控制台 | [desktop.md](./desktop.md) |

代理服务与管理服务是两个独立监听器：代理可单独停止、重启而不影响管理服务，两者都由 `ServerRuntime` 持有。协议范围以 `source/common/protocols.ts` 为准，当前不支持 Gemini 或 Custom 协议。

### 管理 API 契约

管理 API 挂在独立管理服务的 `/api` 前缀（默认 `127.0.0.1:9301`），React UI 与未来的 CLI 复用同一套接口。

设计原则：

- 统一 `POST`，不依赖 HTTP 方法语义；路径格式为 `/api/资源/动作`
- HTTP 状态码始终 200，业务结果由 body 表达

```ts
// 成功
{ success: true, data: { ... } }

// 失败
{ success: false, errorCode: "PROVIDER_NOT_FOUND", errorMessage: "供应商不存在" }
```

接口清单不在文档里维护，按域查阅 `source/server/management/router.ts` 与 `management/routes/`：

| 域 | 源码位置 |
| --- | --- |
| Provider / ProviderModel / 端点 / 调度关系 | `management/routes/catalog/` |
| ProviderModel 绑定关系、请求重写规则 | `management/routes/relations/` |
| 设置、代理生命周期、开发种子 | `management/routes/operations/` |
| 运行日志、请求日志、统计分析 | `management/routes/observability/` |
| 路由工作台（策略图与试跑） | `management/routes/router/` |
| 模型测试、协议发现、出站代理测试 | `management/routes/diagnostics/` |
| 供应商包导入导出 | `management/provider-transfer/` |

所有路由由同一个注册表合并，不提供旧版兼容别名。

### 数据存储

SQLite（`node:sqlite` + Drizzle ORM）承载配置与日志，表结构与字段定义见 [data-model.md](./data-model.md)，Drizzle 定义以 `source/server/database/schema.ts` 为准。

- 首发基线：`drizzle/` 只保留一份 `initial_schema` 基线迁移与快照，`pnpm db:generate` 生成新迁移
- 首发后冻结基线，只追加后续迁移，不改写已发布历史
- API Key 等敏感信息存在系统密钥环中，数据库只存引用 ID

### 运行环境与 profile

开发版与正式版通过 `source/common/runtime-profile.ts` 的显式 profile 区分，profile 统一定义应用数据目录、代理端口、管理端口与管理 API 地址，Electron、服务端与 renderer 共用同一配置源。

| profile | 数据目录 | 代理端口 / 管理端口 |
| --- | --- | --- |
| 开发 | `One Switch Development` | 19300 / 19301 |
| 正式 | `One Switch` | 9300 / 9301 |

数据库文件、`secrets.json` 与监听端口三者完整隔离。

### 渲染进程

React 18 + TypeScript + shadcn/ui + Tailwind。页面通过 `source/render/source/api/*.ts` 调用管理 API，领域状态按 `features/*` 与页面 hooks 组织，`infrastructure/polling-manager.ts` 提供共享轮询，`store/create-store.ts` 提供轻量外部 store。

侧边栏分组与页面清单以 `source/render/source/components/app-sidebar.tsx` 为准，各页面职责见 [desktop.md](./desktop.md) 的控制台页面表。

## 构建与打包

### Vite

- 主进程、预加载脚本、渲染进程统一配置
- 开发时支持热重载（主进程重启、渲染进程 HMR）
- 生产构建自动打包

### electron-builder

- 打包成 macOS `.dmg` / `.app`、Windows `.exe`、Linux `.AppImage` / `.deb`
- macOS 无付费证书阶段使用显式 ad-hoc 签名；`afterPack` 必须对完整 `.app` 执行严格签名校验
- ad-hoc 签名只保证应用包内部完整性，不提供开发者身份信任，也不能提交 Apple 公证
- GitHub Release 必须附带 DMG 的 SHA-256 文件和“隐私与安全 > 仍要打开”的首次安装说明
- 未来购买 Apple Developer Program 后，替换为 Developer ID Application 签名和 Apple notarization；不得把免费 Apple Development 证书用于公网分发
- 自动更新已实现：`source/command/updater.ts` 使用 `electron-updater`，支持检查、手动下载、进度、安装和状态广播；生产环境启动后静默检查，开发环境无更新元数据时显示友好状态。
- 无正式 Developer ID 签名阶段，自动更新明确关闭 macOS 更新包发行者签名校验，下载完整性依赖更新元数据中的 SHA-512。这是当前发布方式的预期取舍；启用正式签名和 Apple notarization 后必须恢复签名校验。

## 开发流程

以下命令与根目录 `package.json` 的 scripts 一致：

1. `pnpm dev` — 启动开发模式
2. `pnpm build` — 执行 typecheck、Vite bundling 和 electron-builder
3. `pnpm typecheck` — TypeScript 类型检查
4. `pnpm lint` — ESLint 检查
5. `pnpm test:server` — 运行 Server/Vitest 测试
6. `pnpm release:win`、`pnpm release:mac`、`pnpm release:linux` — 构建对应平台发布包

## 决策回顾

1. **代理服务纯 Node 化**：不依赖 Electron，可独立测试、未来抽 CLI
2. **管理 API 走 HTTP**：React UI 和未来 CLI/Web 控制台复用同一套 API
3. **原生 http 不引入框架**：减少依赖、完全控制流式行为
4. **轻量外部 Store 管理共享状态**：集中缓存 Provider、健康状态、`default` 逻辑模型和设置，避免页面重复请求与轮询闪烁
5. **shadcn/ui + Tailwind**：组件按需复制、体积小、定制灵活
6. **Vite 统一构建**：一套配置管三个进程，开发体验好
