# One Switch v0.3 数据模型设计

> 本文是新大版本的目标数据库结构。
>
> **发布策略：不兼容旧版本数据库。** 新版本使用全新的数据库初始化结构，不读取、不迁移、不修补旧版本数据库。

## 1. 设计目标

One Switch 的配置内容会持续增加，尤其是供应商、模型端点、认证方式、路由策略和模型能力。因此本版本遵循以下原则：

1. **稳定身份、关系、枚举、开关、数值和查询字段使用独立列。**
2. **只有真正开放、低频、非路由的扩展数据才使用 JSON；JSON 不是标准字段的默认容器。**
3. **多值且具有独立生命周期的内容使用子表，不使用数组 JSON。**
4. **运行时状态与用户配置分离。**
5. **请求日志中的统计指标和常用快照使用独立列；协议私有且不稳定的原始详情才使用 JSON。**
6. **请求/响应正文与日志索引分离，正文按需记录并完整保留。**
7. **历史日志不依赖可变配置，不为日志快照增加外键。**
8. **配置文档使用 `schemaVersion`，配置结构变化通过文档升级解决。**
9. **数据库结构以 Drizzle schema 为唯一代码定义，由生成的 migration 在应用启动时执行；v0.3 不提供旧数据库兼容迁移。**
10. **所有时间戳字段均为 Unix 毫秒（`Date.now()`），不使用秒。**
11. **表名统一为 `settings`，不再引入 `app_config` 作为数据库表名。**
12. **领域前缀按对象边界使用：`provider*` 是配置身份，`client*` 是客户端一侧，`upstream*` 是实际远端 hop。**
13. **请求级协议是 `clientProtocol`；每次 attempt 保存自己的 `upstreamProtocol`。**
14. **一张表 = 一个视角。列名不带视角前缀——视角由表名唯一确定。**
15. **事实永远写入，载荷才受开关控制。** `captureRequestContent` 只决定是否保存正文；是否发生协议转换、命中的改写规则 id、尝试耗时、TTFT、上游跳形态都是**事实**，无论开关如何都必须落库。

### 1.1 术语边界

`Provider` 是配置实体，不等同于运行时 upstream。一次 upstream 可能直接指向 Provider，也可能经过协议转换器、兼容层或其他中间目标。因而：

- `providerId`、`providerModelId`、`providerName` 和 `providerModelName` 仅用于配置身份或历史快照；
- `clientProtocol`、`clientRequest*` 和 `clientResponse*` 描述客户端边界；
- `upstreamProtocol`、`upstreamRequest*` 和 `upstreamResponse*` 描述实际远端 HTTP hop；
- `request_attempts` 只保存一次 attempt 的 upstream 事实快照；
- **协议转换是派生事实，不单独建表**：`clientProtocol` ≠ `request_attempts.upstreamProtocol` 即说明发生了转换，上游跳以什么形态回来由 `request_attempts.upstreamTransport` 表达。转换不需要第三张表，因为第三张表只能重复保存前两张表已有的信息；
- 客户端视角载荷归 `request_contents`，上游视角载荷归 `attempt_contents`；
- 用量也按视角拆表：请求级用量归 `request_usages`，尝试级用量归 `attempt_usages`。**不存在用可空列判别归属的行**——如果一行的含义取决于某列是否为空，那它其实是两张表；
- 正文表的一行只属于一个视角，因此表名即视角，列名不再带 `client` / `upstream` 前缀。

## 2. 数据库总览

v0.3 包含以下 22 张核心表。

数据库启动时通过 Drizzle runtime migrator 应用 `drizzle/` 下的生成 migration，并由 `__drizzle_migrations` 记录已执行版本。`logical_models.default` 是应用 seed，不属于 schema migration。preview 阶段 `drizzle/` 只保留一个由 schema 直接生成的首发基线，因此兼容性判定不需要维护任何「历史表名」清单：`__drizzle_migrations` 里出现基线之外的 migration，或者库里有表却没有任何 migration 记录，就直接拒绝启动，要求用户重新初始化数据库。

数据文件名为 `one-switch-v<主版本号>.db`（例如 `one-switch-v1.db`），主版本号取自应用版本号（`packages/contracts/source/database-file.ts` 是这条规则的唯一实现）。这意味着发布一个不兼容的大版本时，应用会在全新的文件上初始化，旧文件既不读取也不删除——所谓「不兼容旧版本」因此不需要任何检测代码，只是换了一个文件名。

| 表 | 用途 | 数据性质 |
| --- | --- | --- |
| `settings` | 全局应用配置 | 命名空间 KV 配置 |
| `providers` | 供应商稳定身份与生命周期 | 配置实体 |
| `provider_health` | Provider 聚合运行时健康状态 | 高频运行状态 |
| `provider_model_health` | ProviderModel 运行时健康状态 | 高频运行状态 |
| `provider_models` | Provider 上的真实模型与路由配置 | 配置实体 |
| `provider_settings` | Provider 级命名空间 KV 设置 | 配置实体 |
| `provider_endpoints` | Provider 按协议的默认端点 | 配置实体 |
| `provider_model_endpoints` | ProviderModel 到 Provider 端点的绑定 | 配置实体 |
| `protocol_converters` | ProviderModel 端点允许的客户端协议转换器 | 配置实体 |
| `logical_models` | 对外暴露的逻辑模型 | 配置实体 |
| `request_rewrite_rules` | 可复用的请求/响应改写规则 | 配置实体 |
| `provider_model_request_rewrite_rules` | ProviderModel 与改写规则的启用关系 | 配置实体 |
| `workflows` | 工作流定义 | 配置实体 |
| `scheduling_policies` | 逻辑模型的调度策略 | 配置实体 |
| `request_logs` | 每次代理请求的汇总日志 | 历史观测数据 |
| `request_attributes` | 请求客户端/网络属性 | 历史观测数据 |
| `request_usages` | 请求级用量数值明细 | 历史观测数据 |
| `attempt_usages` | 单次尝试级用量数值明细 | 历史观测数据 |
| `request_attempts` | 请求内每次远端尝试 | 历史观测数据 |
| `request_contents` | 客户端视角的请求与响应正文 | 可选历史观测数据 |
| `attempt_contents` | 上游视角的请求与响应正文 | 可选历史观测数据 |
| `runtime_logs` | 应用运行时日志 | 可选历史观测数据 |

关系概览：

```mermaid
erDiagram
  providers ||--o{ provider_settings : configures
  providers ||--o{ provider_endpoints : defaults
  providers ||--o{ provider_models : contains
  providers ||--|| provider_health : aggregates
  provider_models ||--|| provider_model_health : has
  logical_models ||--o{ scheduling_policies : orders
  provider_models ||--o{ scheduling_policies : participates
  provider_models ||--o{ provider_model_endpoints : exposes
  provider_model_endpoints ||--o{ protocol_converters : enables
  provider_endpoints ||--o{ provider_model_endpoints : binds
  request_logs ||--o{ request_usages : records
  request_logs ||--o{ request_contents : captures
  request_logs ||--o{ request_attempts : contains
  request_attempts ||--o{ attempt_usages : produces
  request_attempts ||--o| attempt_contents : captures
  providers ||--o{ request_attempts : attempted_by
  provider_models ||--o{ provider_model_request_rewrite_rules : enables
  request_rewrite_rules ||--o{ provider_model_request_rewrite_rules : applied_by
  request_logs ||--o{ request_attributes : annotates

  settings {
    text key PK
    text value
    text valueType
    integer updatedTime
  }

  providers {
    text id PK
    text name
    text description
    boolean enabled
    integer createdTime
    integer updatedTime
    integer deletedTime
  }

  provider_settings {
    text providerId PK, FK
    text key PK
    text value
    text valueType
    integer updatedTime
  }

  scheduling_policies {
    text logicalModelId PK, FK
    text providerModelId PK, FK
    text strategy
    integer priority
    integer weight
    boolean enabled
    integer createdTime
    integer updatedTime
    integer deletedTime
  }

  provider_endpoints {
    text id PK
    text providerId FK
    text protocol
    text url
    boolean enabled
    integer createdTime
    integer updatedTime
  }

  logical_models {
    text id PK
    text name UK
    text description
    boolean enabled
    integer sortOrder
    integer createdTime
    integer updatedTime
    integer deletedTime
  }

  provider_models {
    text id PK
    text providerId FK
    text modelName
    boolean enabled
    integer priority
    integer weight
    integer createdTime
    integer updatedTime
    integer deletedTime
  }

  provider_model_endpoints {
    text id PK
    text providerModelId FK
    text providerEndpointId FK
    text url
    boolean enabled
    integer createdTime
    integer updatedTime
  }

  protocol_converters {
    text id PK
    text providerModelEndpointId FK
    text clientProtocol
    boolean enabled
    integer createdTime
    integer updatedTime
  }

  provider_health {
    text providerId PK, FK
    integer consecutiveFailures
    integer cooldownUntilTime
    integer lastSuccessTime
    integer lastFailureTime
    integer updatedTime
  }

  provider_model_health {
    text providerModelId PK, FK
    integer consecutiveFailures
    integer cooldownUntilTime
    integer lastSuccessTime
    integer lastFailureTime
    integer updatedTime
  }

  request_logs {
    text id PK
    text logicalModelId
    text clientProtocol
    text transport
    text status
    integer totalDurationMilliseconds
    integer createdTime
  }

  request_usages {
    text requestId PK, FK
    text type PK
    real value
    text rawValue
    integer createdTime
  }

  attempt_usages {
    text attemptId PK, FK
    text type PK
    real value
    text rawValue
    integer createdTime
  }

  request_contents {
    text id PK
    text requestId FK
    text captureStatus
    text requestMethod
    text requestPath
    text requestHeaders
    text requestBody
    integer responseStatus
    text responseHeaders
    text responseBody
    integer createdTime
    integer updatedTime
  }

  attempt_contents {
    text id PK
    text attemptId UK, FK
    text captureStatus
    text requestHeaders
    text requestBody
    integer responseStatus
    text responseHeaders
    text responseBody
    integer createdTime
    integer updatedTime
  }

  request_attempts {
    text id PK
    text status
    text requestId FK
    text providerId
    text providerModelId
    text providerName
    text providerModelName
    text upstreamProtocol
    text upstreamRequestId
    text url
    boolean retryable
    integer httpStatus
    integer attemptIndex
    integer durationMilliseconds
    text upstreamTransport
    integer ttftMilliseconds
    text requestRewriteRuleIds
    text responseRewriteRuleIds
    text errorCode
    text errorMessage
    integer createdTime
  }

  request_attributes {
    text requestId PK, FK
    text key PK
    text value
    integer createdTime
  }

  runtime_logs {
    integer id PK
    text level
    text message
    integer timestamp
  }

  request_rewrite_rules {
    text id PK
    text name
    text description
    boolean enabled
    text scope
    integer schemaVersion
    text source
    text match
    text actions
    text testCases
    integer createdTime
    integer updatedTime
    integer deletedTime
  }

  provider_model_request_rewrite_rules {
    text providerModelId PK, FK
    text requestRewriteRuleId PK, FK
    integer priority
    boolean enabled
    integer createdTime
    integer updatedTime
    integer deletedTime
  }

  workflows {
    text id PK
    text type
    integer version
    text name
    text definition
    integer createdTime
    integer updatedTime
    integer deletedTime
  }
```

## 3. 表结构

以下 SQL 描述目标结构。实际实现使用 Drizzle schema 和运行时初始化 SQL，字段命名保持现有项目的 camelCase 约定。

### 3.1 `settings`

全局配置使用逐项存储：每个配置项一行，标准设置使用明确的 `valueType` 和 Schema；只有数组、对象等确实需要文档表达的设置才保存 JSON。这样既保留配置 key，又避免把端口、开关、超时等标准字段塞进 config。

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  valueType TEXT NOT NULL,
  updatedTime INTEGER NOT NULL
);

CREATE INDEX idx_settings_updated_time
  ON settings(updatedTime);
```

推荐的 key：

```text
proxy.listenHost
proxy.listenPort
proxy.idleTimeoutSeconds
routing.cooldownBaseSeconds
routing.cooldownMaxSeconds
routing.consecutiveFailureThreshold
logging.retentionDays
logging.captureRequestContent
desktop.autoLaunch
ui.theme
ui.visibleColumns
```

示例记录：

| key | value | valueType |
| --- | --- | --- |
| `proxy.listenPort` | `9300` | `number` |
| `proxy.listenHost` | `"127.0.0.1"` | `string` |
| `desktop.autoLaunch` | `false` | `boolean` |
| `ui.visibleColumns` | `[...]` | `array` |

标量值按 `valueType` 编码保存：`string` 使用文本，`number` 使用十进制文本，`boolean` 使用 `0`/`1`；仅 `array` 和 `object` 使用 JSON。`valueType` 用于诊断和导出展示，真正的类型校验由对应的 Zod Schema 负责。

新增配置项只需要增加命名空间 key、默认值和 Schema，不需要修改数据库表。批量更新必须在一个事务中完成；读取时合并数据库已有值和默认值，并拒绝未知 key 或记录警告。

### 3.2 `providers`

Provider 只保存稳定身份和生命周期。连接超时、密钥引用等运行所需设置统一放入 `provider_settings`；认证方式由协议适配器根据端点协议决定，不作为 Provider 配置持久化。

```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);

CREATE INDEX idx_providers_enabled ON providers(enabled);
CREATE INDEX idx_providers_deleted_time ON providers(deletedTime);
```

### 3.3 `provider_settings`

Provider 级设置采用与全局 `settings` 相同的命名空间 KV 结构，通过 `providerId` 区分不同 Provider。超时、密钥引用等设置不再固化为表列；标准 key 仍由 Schema、默认值和 `valueType` 约束。超时配置使用秒，运行时再转换为毫秒。

```sql
CREATE TABLE provider_settings (
  providerId TEXT NOT NULL REFERENCES providers(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  valueType TEXT NOT NULL,
  updatedTime INTEGER NOT NULL,
  PRIMARY KEY (providerId, key)
);

CREATE INDEX idx_provider_settings_key
  ON provider_settings(key);
```

推荐的 key：

```text
connection.timeoutSeconds
security.secretReference
```

### 3.4 `provider_endpoints`

Provider 按协议持有默认端点。ProviderModel 通常只引用默认端点；`provider_model_endpoints.url` 为空时使用默认端点的 `url`。

```sql
CREATE TABLE provider_endpoints (
  id TEXT PRIMARY KEY,
  providerId TEXT NOT NULL REFERENCES providers(id),
  protocol TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);

-- 同一供应商同一协议只允许一条未删除的端点；软删除的行留在表里，
-- 因此唯一约束必须是部分索引，否则重新添加同一协议会撞上历史行。
CREATE UNIQUE INDEX idx_provider_endpoints_provider_protocol_active
  ON provider_endpoints(providerId, protocol) WHERE deletedTime IS NULL;
CREATE INDEX idx_provider_endpoints_protocol
  ON provider_endpoints(protocol, enabled);
CREATE INDEX idx_provider_endpoints_deleted_time
  ON provider_endpoints(deletedTime);
```

密钥本身仍然不能进入数据库，只保存系统密钥环中的引用。

### 3.5 `logical_models`

v0.3 MVP 只初始化并暴露一个逻辑模型 `default`。它是代理内部的兜底逻辑模型，代表当前启用的 ProviderModel 自动切换池；客户端请求中的任意非空模型名在没有匹配到其他逻辑模型时都由它处理，无需显式请求 `default`。MVP 不支持创建、删除或配置多个逻辑模型。表结构提前保留未来扩展所需的身份和生命周期字段。

```sql
CREATE TABLE logical_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);

CREATE INDEX idx_logical_models_enabled ON logical_models(enabled);
CREATE INDEX idx_logical_models_deleted_time ON logical_models(deletedTime);
```

初始化时必须幂等创建 `default`，并保证 MVP 中不存在其他启用的逻辑模型。

### 3.6 `scheduling_policies`

`scheduling_policies` 是 **LogicalModel 与 ProviderModel 之间的调度绑定表**，不是逻辑模型的单独全局策略配置。每一行表示一个 ProviderModel 是否加入某个逻辑模型的候选池，以及它在该候选池中的顺序和权重。因此，不同逻辑模型可以绑定相同的 ProviderModel，但为其配置不同的 `priority`、`weight` 和启用状态；ProviderModel 本身不再拥有跨逻辑模型共享的全局排序。

v0.3 只支持 `strategy = priority`，并在 `default` 初始化时为需要的 ProviderModel 创建绑定。请求体中的 `model` 命中已启用逻辑模型的 ID 或名称时使用该逻辑模型；未命中时使用已启用的 `default` 逻辑模型。MVP 不提供多逻辑模型 CRUD，P2 再开放每个逻辑模型的绑定管理。

```sql
CREATE TABLE scheduling_policies (
  logicalModelId TEXT NOT NULL REFERENCES logical_models(id),
  providerModelId TEXT NOT NULL REFERENCES provider_models(id),
  strategy TEXT NOT NULL DEFAULT 'priority' CHECK (strategy IN ('priority')),
  priority INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 100 CHECK (weight > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER,
  PRIMARY KEY (logicalModelId, providerModelId)
);

CREATE INDEX idx_scheduling_policies_route
  ON scheduling_policies(logicalModelId, enabled, priority, weight);
CREATE INDEX idx_scheduling_policies_deleted_time
  ON scheduling_policies(deletedTime);
```

`request_logs.logicalModelId` 保留实际处理请求的逻辑模型标识，但不建立外键。MVP 中请求体只要求 `model` 为非空字符串；路由先按请求模型匹配逻辑模型，未匹配时才回退到 `default` 的启用绑定。

### 3.7 `provider_models`、`provider_model_endpoints` 与 `protocol_converters`

`provider_models` 是 Provider 上可被路由的真实模型配置。路由、启用和协议端点都是稳定且经常查询的字段，必须拆成列和子表，不再放进 JSON。ProviderModel 的 `modelName` 表示供应商 API 中的实际模型名；表自身的实体身份使用 `id`，其他表通过 `providerModelId` 引用。

```sql
CREATE TABLE provider_models (
  id TEXT PRIMARY KEY,
  providerId TEXT NOT NULL REFERENCES providers(id),
  modelName TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);

CREATE TABLE provider_model_endpoints (
  id TEXT PRIMARY KEY,
  providerModelId TEXT NOT NULL REFERENCES provider_models(id),
  providerEndpointId TEXT NOT NULL REFERENCES provider_endpoints(id),
  url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);

CREATE TABLE protocol_converters (
  id TEXT PRIMARY KEY,
  providerModelEndpointId TEXT NOT NULL REFERENCES provider_model_endpoints(id),
  clientProtocol TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);

CREATE UNIQUE INDEX idx_provider_models_provider_model_active
  ON provider_models(providerId, modelName) WHERE deletedTime IS NULL;
CREATE INDEX idx_provider_models_enabled
  ON provider_models(providerId, enabled, deletedTime);
CREATE UNIQUE INDEX idx_provider_model_endpoints_unique_active
  ON provider_model_endpoints(providerModelId, providerEndpointId) WHERE deletedTime IS NULL;
CREATE INDEX idx_provider_model_endpoints_provider_endpoint
  ON provider_model_endpoints(providerEndpointId, enabled);
CREATE INDEX idx_provider_model_endpoints_deleted_time
  ON provider_model_endpoints(deletedTime);
CREATE UNIQUE INDEX idx_protocol_converters_unique_active
  ON protocol_converters(providerModelEndpointId, clientProtocol) WHERE deletedTime IS NULL;
CREATE INDEX idx_protocol_converters_protocol
  ON protocol_converters(clientProtocol, enabled);
CREATE INDEX idx_protocol_converters_deleted_time
  ON protocol_converters(deletedTime);
```

端点解析规则：优先使用 `provider_model_endpoints.url`，为空时使用其 `providerEndpointId` 对应的 `provider_endpoints.url`；协议始终来自 Provider 端点，不在端点绑定表重复保存。

只有低频、非路由且尚未形成稳定产品语义的扩展信息才允许进入后续专门的扩展表；核心模型能力不在 v0.3 虚构为 JSON 字段。候选条件为：ProviderModel 和 Provider 均启用、未软删除，且存在启用的 ProviderModel 端点。

### 3.8 `provider_health` 与 `provider_model_health`

Provider 聚合健康状态和 ProviderModel 独立健康状态都是运行时状态，必须与静态配置分离。ProviderModel 健康状态用于精确跳过单个故障模型；Provider 健康状态用于表示整个 Provider 的聚合可用性。

```sql
CREATE TABLE provider_health (
  providerId TEXT PRIMARY KEY,
  consecutiveFailures INTEGER NOT NULL DEFAULT 0,
  cooldownUntilTime INTEGER,
  lastSuccessTime INTEGER,
  lastFailureTime INTEGER,
  updatedTime INTEGER NOT NULL,

  FOREIGN KEY (providerId) REFERENCES providers(id)
);

CREATE TABLE provider_model_health (
  providerModelId TEXT PRIMARY KEY,
  consecutiveFailures INTEGER NOT NULL DEFAULT 0,
  cooldownUntilTime INTEGER,
  lastSuccessTime INTEGER,
  lastFailureTime INTEGER,
  updatedTime INTEGER NOT NULL,

  FOREIGN KEY (providerModelId) REFERENCES provider_models(id)
);
```

该表不保存用户配置，也不进入任何配置文档。健康状态更新需要支持原子更新和高频写入。

路由规则：候选 ProviderModel 必须同时满足 Provider 和 ProviderModel 未禁用、未软删除，且各自的 `cooldownUntilTime` 为空或已到期。Provider 级认证或网络故障更新 `provider_health`，单模型错误更新 `provider_model_health`；请求成功时更新两层的最近成功时间并按各自聚合范围重置失败计数。

生命周期约定：**创建 Provider 时在同一事务中插入 `provider_health` 初始行，创建 ProviderModel 时在同一事务中插入 `provider_model_health` 初始行**。删除 Provider 或 ProviderModel 时按第 8 节规则处理。路由层可以假定：存在配置实体即存在对应的 health 行，无需处理缺失分支。

### 3.9 `request_logs`

请求日志只保存请求身份、客户端协议、客户端声明的传输形态、状态、逻辑模型和总耗时。Token、缓存等可聚合数值不放入 `request_logs`，分别存入 `request_usages` 和 `attempt_usages`，避免持续修改日志主表。

```sql
CREATE TABLE request_logs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
  clientProtocol TEXT,
  transport TEXT NOT NULL DEFAULT 'http',
  logicalModelId TEXT,
  totalDurationMilliseconds INTEGER NOT NULL DEFAULT 0,
  createdTime INTEGER NOT NULL
);

CREATE INDEX idx_request_logs_created_time
  ON request_logs(createdTime);

-- 状态过滤总是与时间窗一起出现（失败原因分布、成功率）。
-- 只有 status 一列时，SQLite 会先把该状态的全部历史行找出来再逐行比时间，
-- 代价与时间窗无关——30 天与 7 天一样慢。
CREATE INDEX idx_request_logs_status_created_time
  ON request_logs(status, createdTime);

CREATE INDEX idx_request_logs_logical_model
  ON request_logs(logicalModelId);

CREATE INDEX idx_request_logs_client_protocol
  ON request_logs(clientProtocol);
```

`clientProtocol` 与 `logicalModelId` 均可为空：请求可能在协议识别或模型解析之前就被拒掉，但它同样是用户真实发出的请求，必须留下记录。为空表达的是「还没走到那一步」，不是「没有这一列」。

`transport` 是**请求进入代理时就已经定下的预期**（客户端要整包还是增量，见 [proxy-engine.md](./proxy-engine.md) §1.1）——它是客户端跳的形态，取自入口对请求体的解析，因此属于请求级事实；上游跳实际是什么形态是**上游视角的事实**，写在 `request_attempts.upstreamTransport` 上。两者不相等不是「上游不配合」这种可容错的小事，而是「本次传输无法按声明兑现」——代理不自己攒出一份整包来弥合（见 [proxy-engine.md](./proxy-engine.md) §1.2）。`totalDurationMilliseconds` 是从收到请求到写完响应的总耗时，它无法由尝试耗时稳定推导（尝试之间还有调度与等待），因此落在日志主表。

原始协议 `usage` 报文不再占用日志主表的列：它属于某个视角的一份事实，以 `type = 'raw'` 的记录保存在对应的用量表里（见 3.10）。

### 3.10 `request_usages` / `attempt_usages`

用量按**视角**拆成两张表，与正文表遵循同一条原则：一张表 = 一个视角，列名不带视角前缀。

| 表 | 表达的视角 | 行数 | 主键 |
| --- | --- | --- | --- |
| `request_usages` | 请求级 | 每个请求、每种用量类型一行 | `(requestId, type)` |
| `attempt_usages` | 尝试级 | 每次尝试、每种用量类型一行 | `(attemptId, type)` |

`request_usages` 是独立的关系表，而不是另一个数据库。每个数值用量保存为一行，便于按 `type`、时间和请求关联进行范围筛选、分组和汇总。

```sql
CREATE TABLE request_usages (
  requestId TEXT NOT NULL REFERENCES request_logs(id),
  type TEXT NOT NULL CHECK (type IN (
    'inputTokens', 'outputTokens', 'cachedInputTokens',
    'cacheCreationInputTokens', 'reasoningTokens', 'raw'
  )),
  value REAL,
  rawValue TEXT,
  createdTime INTEGER NOT NULL,
  PRIMARY KEY (requestId, type),
  CHECK ((type = 'raw' AND value IS NULL AND rawValue IS NOT NULL)
      OR (type <> 'raw' AND value IS NOT NULL AND rawValue IS NULL))
);

CREATE TABLE attempt_usages (
  attemptId TEXT NOT NULL REFERENCES request_attempts(id),
  type TEXT NOT NULL CHECK (type IN (
    'inputTokens', 'outputTokens', 'cachedInputTokens',
    'cacheCreationInputTokens', 'reasoningTokens', 'raw'
  )),
  value REAL,
  rawValue TEXT,
  createdTime INTEGER NOT NULL,
  PRIMARY KEY (attemptId, type),
  CHECK ((type = 'raw' AND value IS NULL AND rawValue IS NOT NULL)
      OR (type <> 'raw' AND value IS NOT NULL AND rawValue IS NULL))
);

-- 用量聚合的过滤条件永远只有时间窗（五种类型总是一起取，不会只查其中一种），
-- 再按请求/尝试分组。`(type, createdTime)` 服务不了这种形态：type 是等值条件之外的
-- 第二列，查询里没有 type 条件时索引最左列就用不上。
CREATE INDEX idx_request_usages_created_time
  ON request_usages(createdTime);

CREATE INDEX idx_attempt_usages_created_time
  ON attempt_usages(createdTime);
```

`type` 表示标准用量名，数值写在 `value` 上。**`totalTokens` 不落库**：它是 `inputTokens` 与 `outputTokens` 的派生量，存下来必然有一天与两个加数不一致，读取侧现算即可。

`attempt_usages` 不再重复保存 `requestId`：请求归属由 `request_attempts.requestId` 唯一持有。这一列是纯冗余，且当一次尝试已经落库、但用量行还在飞的时候，两份 `requestId` 可能短暂不一致。

原始协议 `usage` 报文不另开列：它按**视角**落在同一张用量表里，用 `type = 'raw'` 的行把 Provider 原样返回的报文写进 `rawValue`，并且此时 `value` 必须为空。让原始报文与数值共用一张表，是因为「原始报文」同样只是某个视角的一份事实；用 `value = 0` 占位会静默污染 `sum(value)`，因此这个形状约束由 CHECK 在数据库层强制——`raw` 行 `value` 为空且 `rawValue` 非空，数值行反之。

请求级 `raw` 行保存 Provider 原样返回的 `usage` 对象：

```json
{
  "prompt_tokens": 1500,
  "prompt_tokens_details": { "cached_tokens": 900 },
  "completion_tokens": 120
}
```

它只用于回溯与排查，不参与聚合——聚合一律走 `request_usages` / `attempt_usages` 的数值行。

名称快照不放在 `request_logs`：`request_attempts` 已在写入时保存 `providerName`、`providerModelName` 和实际 `url`，供配置实体被删除后日志详情页仍能展示；`request_logs.logicalModelId` 是稳定列。请求级不再复制一份供应商快照——一次请求可能尝试过多个供应商，「请求级的供应商快照」必须回答「记哪个」这个没有确定答案的问题，而尝试级快照天然没有这个问题。

请求总耗时是请求级事实，落在 `request_logs.totalDurationMilliseconds`；缓存命中是派生量，由 `cachedInputTokens > 0` 现算，不单独落库。Token、缓存 Token 和其他协议用量按视角放入 `request_usages` / `attempt_usages`，不得重复记录。TTFT 是**尝试级事实**，写在 `request_attempts.ttftMilliseconds` 上——把尝试级样本平均成「请求级 TTFT」会直接污染延迟分布；需要请求粒度展示时按 `min(ttftMilliseconds)` 现算，不落库。`request_logs` 只保留请求身份、客户端协议、传输形态、状态、逻辑模型、总耗时和创建时间等稳定字段。

日志表的稳定查询字段为：

- `logicalModelId`；
- `clientProtocol`；
- `transport`；
- `totalDurationMilliseconds`；
- `status`；
- `createdTime`。

未来增加新的 Token 类型、缓存用量或计费明细时，使用新的 `request_usages.type` / `attempt_usages.type`，不需要修改表结构；协议私有不稳定的字段继续留在 `raw` 行里。

### 3.11 `request_contents`

请求正文和响应正文属于大体积、可能包含敏感信息且变化频繁的数据，不直接塞入 `request_logs` 或 `request_attempts` 的宽表。

正文按**视角**拆成两张表，而不是在同一张表里用可空外键区分含义：

| 表 | 表达的视角 | 行数 | 定位 |
| --- | --- | --- | --- |
| `request_contents` | 客户端 | 每个请求一行 | 客户端发来的请求与最终收到的响应 |
| `attempt_contents` | 上游 | 每次尝试一行 | 真正发给 Provider 的请求与 Provider 返回的响应 |

这是本节最重要的结构约束：**一张表只表达一个视角，因此表名即视角，列名不带 `client` / `upstream` 前缀**。旧设计用 `attemptId` 是否为空来推断列的含义，使得 `requestHeaders`、`responseBody` 这些列在不同行里指向不同的东西，且响应头不得不同时提供 `upstreamResponseHeaders` 与 `clientResponseHeaders` 两列；一旦某处写错视角，读出来依然「像是对的」。拆分后每次写入只有一个合法目标表，视角歧义在结构上不存在。

同一条原则也适用于**归属冗余**：`attempt_contents` 不保存 `requestId`。尝试属于哪个请求由 `request_attempts.requestId` 唯一表达，在正文行上再存一份只是把同一个事实写两遍——而同一请求的两个尝试可能有不同的上游协议、不同的模型、不同的改写结果，因此改写规则 id 也属于尝试而不是请求。

`request_contents` 列定义：

- `requestMethod` / `requestPath`：客户端请求的方法与路径。请求级信息天然属于客户端视角，因此只存在于本表；
- `requestHeaders`：客户端请求头（脱敏后）；
- `requestBody`：客户端请求正文；
- `responseStatus`：最终返回给客户端的状态码；
- `responseHeaders`：最终返回给客户端的响应头（脱敏后）。只有真正写出客户端时才有值，未写出时为 `NULL`，绝不回落到上游响应头；
- `responseBody`：最终返回给客户端的响应正文（协议转换后的形态）。

`attempt_contents` 列定义：

- `requestHeaders`：实际发往上游的请求头（脱敏后，已完成改写与协议转换）；
- `requestBody`：实际发往上游的请求正文；
- `responseStatus`：上游返回的状态码；
- `responseHeaders`：上游返回的响应头（脱敏后）；
- `responseBody`：上游返回的响应正文（协议转换前的原始形态）。

`attempt_contents` **只保存载荷**。改写规则 id、上游跳形态、TTFT 都是事实，写在 `request_attempts` 上：规则按 ProviderModel 匹配，归属单位是「尝试」；而事实必须在采集开关关闭时依然完整落库，不能和正文挤在同一张表里。日志详情页需要的规则集合由 `request_attempts.requestRewriteRuleIds` ∪ `responseRewriteRuleIds` 聚合而成。

`captureStatus` 枚举定稿：

| 值 | 含义 |
| --- | --- |
| `captured` | 完整采集 |
| `partial` | 流式采集中断或部分丢失 |

这两个值由 CHECK 约束在数据库层强制。「未开启采集」的正确表达是**根本没有正文行**，「采集异常」的正确表达同样是**没有行**或 `partial`；枚举里多一个永远进不去的值，只会让读取方多一条永远走不到的分支。

日志详情页根据 `captureStatus` 展示不同状态，而不是猜测内容为空的原因。

建议首发结构如下：

```sql
CREATE TABLE request_contents (
  id TEXT PRIMARY KEY,
  requestId TEXT NOT NULL REFERENCES request_logs(id),
  captureStatus TEXT NOT NULL CHECK (captureStatus IN ('captured', 'partial')),
  requestMethod TEXT NOT NULL,
  requestPath TEXT NOT NULL,
  requestHeaders TEXT,
  requestBody TEXT,
  responseStatus INTEGER,
  responseHeaders TEXT,
  responseBody TEXT,
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL
);

CREATE TABLE attempt_contents (
  id TEXT PRIMARY KEY,
  attemptId TEXT NOT NULL REFERENCES request_attempts(id),
  captureStatus TEXT NOT NULL CHECK (captureStatus IN ('captured', 'partial')),
  requestHeaders TEXT,
  requestBody TEXT,
  responseStatus INTEGER,
  responseHeaders TEXT,
  responseBody TEXT,
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_request_contents_request
  ON request_contents(requestId);
CREATE UNIQUE INDEX idx_attempt_contents_attempt
  ON attempt_contents(attemptId);
```

正文列只保存脱敏后的原始内容或明确的正文 envelope。由于视角已由表决定，每份载荷在全库中恰好只有一个归属，不存在需要跨表比对的重复列。

```json
{
  "schemaVersion": 1,
  "method": "POST",
  "path": "/v1/messages",
  "headers": {
    "content-type": "application/json"
  },
  "capturedAt": 1755643200000
}
```

正文 envelope 只有两种形态，由**本次传输是否逐帧**决定（`request_logs.transport` 是不是 `http-stream`，不是「是不是流式请求」——见 [proxy-engine.md](./proxy-engine.md) §1.1）：

逐帧传输时存分块 envelope，保留每个 chunk 的原始文本（SSE 事件可能跨 chunk，拼回去才能重放）：

```json
{
  "schemaVersion": 1,
  "chunks": ["data: {...}\n\n", "data: [DONE]\n\n"]
}
```

其余情况存脱敏后的原文文本（JSON 也存文本，不做二次解析——代理对报文内容只做改写，不做建模）。

> 正文表只存脱敏后的原文文本与 chunk 数组，不另存结构化正文字段：把 `body` / `bodyText` / `contentType` 这类解析结果也存一遍，等于把「谁解析报文」从代理挪到了渲染进程。流式与否同样不单独占一列——库里的 `request_logs.transport` 只表示**客户端跳的传输形态**（代理层对应 `ExchangeView.transport`），`request_attempts.upstreamTransport` 才是**上游跳实际是什么形态**。

#### 3.11.1 转换事实为什么不建表

转换事实不单独建表。它要回答的只有一个问题：**这次尝试发生了什么转换**，而它要记的每一项都可以从别处推导：

| 转换相关字段 | 唯一的真实出处 |
| --- | --- |
| `clientProtocol` | `request_logs.clientProtocol` |
| `upstreamProtocol` | `request_attempts.upstreamProtocol` |
| `upstreamTransport` | `request_attempts.upstreamTransport` |
| `durationMilliseconds` | `request_attempts.durationMilliseconds` |
| `requestId` | `request_attempts.requestId` |

其中 `clientProtocol` 与 `upstreamProtocol` **不相等**这一事实本身，就是「发生了转换」的唯一判据：

```text
发生协议转换  ⇔  request_logs.clientProtocol ≠ request_attempts.upstreamProtocol
```

把这张表建出来不会带来任何独立信息，还会引入两个具体问题：

1. **漂移的第二份耗时。** `request_conversions.durationMilliseconds` 与 `request_attempts.durationMilliseconds` 是同一事实的两份副本，两份副本必然有一天不一致，而且不一致时无法判断谁对。
2. **「没发生转换」和「没记录」不可区分。** 未发生转换的尝试没有对应行，所以「查不到转换记录的尝试」既可能是同一协议直通，也可能是转换记录丢失，读取方无法判断。

转换事实因此并入 `request_attempts`：一次尝试永远是恰好一行，事实永远存在，不需要任何 JOIN 也不需要任何存在性判断。

`request_contents` 与 `attempt_contents` 两张视角表加上 `request_attempts` 这一张事实表，就足以支撑日志详情页的每一个展示位：

| 详情页展示位置 | 唯一数据来源 |
| --- | --- |
| 客户端原始请求 | `request_contents.requestHeaders` / `requestBody` |
| 发送到上游的请求 | `attempt_contents.requestHeaders` / `requestBody` |
| 真实供应商响应 | `attempt_contents.responseHeaders` / `responseBody` |
| 返回客户端的响应 | `request_contents.responseHeaders` / `responseBody` |
| 已应用修改器 | `request_attempts.requestRewriteRuleIds` ∪ `responseRewriteRuleIds` |
| 协议与上游跳形态 | `request_attempts.upstreamProtocol` ∪ `request_attempts.upstreamTransport`，与 `request_logs.clientProtocol` / `request_logs.transport` 对比得出转换 |

安全与容量约束：

- 默认开启正文采集，用户可在设置中显式关闭；关闭后不再记录新正文，但不会自动删除已有内容；
- 采集与保留是两个独立维度：`captureRequestLogs` / `captureRequestContent` 各管一个开关，`requestLogRetentionDays`（默认 `0`，即永久）与 `contentRetentionDays`（默认 `7` 天）各管一个时间窗；`0` 一律表示永久保留；
- 日志清理支持按保留天数执行，并同时删除请求正文、正文中的尝试内容、尝试记录和请求汇总；
- 只清理正文时不删除任何「非载荷」行：`request_contents` / `attempt_contents` 走掉，请求汇总、尝试记录与用量行保留，因此历史统计不受影响；
- API Key、Authorization、Cookie、Set-Cookie 等敏感请求头必须脱敏，正文自身不视为已脱敏；
- 本地工具不限制正文大小，完整读取并保存已接收的请求和响应内容，以支持超长上下文和大体积请求；由此产生的内存与存储占用属于明确设计取舍；
- 流式响应记录已接收的事件/文本片段，不阻塞代理转发，不因日志写入失败影响请求；
- 流式响应按客户端跳声明的传输形态，将每次收到或写出的原始 chunk 字符串数组保存，不聚合为统一消息正文，也不重新按 SSE 事件切分；
- 清理请求日志时，依次删除 `attempt_contents`、`attempt_usages`、`request_contents`、`request_usages`、`request_attributes`、`request_attempts`，最后删除 `request_logs`；一边删子行一边删父行会撞上外键约束，因此每次必须先把子行删完；
- 导出日志必须明确包含正文和指标的开关，默认不导出正文但保留可选指标。

### 3.12 `request_attempts`

每次实际 Upstream 尝试一行。除了故障转移顺序和统计所需字段，这张表还承载**所有与「这次尝试发生了什么」相关的非载荷事实**：协议转换、上游跳形态、TTFT、命中的改写规则。原始 `usage` 报文不属于这里——它是用量，按视角保存在 `attempt_usages` 的 `raw` 行里。

```sql
CREATE TABLE request_attempts (
  id TEXT PRIMARY KEY,
  requestId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  providerModelId TEXT NOT NULL,
  providerName TEXT NOT NULL,
  providerModelName TEXT NOT NULL,
  upstreamProtocol TEXT,
  upstreamRequestId TEXT,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'cancelled')),
  httpStatus INTEGER,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  upstreamTransport TEXT,
  attemptIndex INTEGER NOT NULL,
  durationMilliseconds INTEGER NOT NULL,
  ttftMilliseconds INTEGER,
  errorCode TEXT,
  errorMessage TEXT,
  requestRewriteRuleIds TEXT NOT NULL DEFAULT '[]',
  responseRewriteRuleIds TEXT NOT NULL DEFAULT '[]',
  createdTime INTEGER NOT NULL,

  FOREIGN KEY (requestId) REFERENCES request_logs(id),
  UNIQUE (requestId, attemptIndex)
);

CREATE INDEX idx_request_attempts_request_order
  ON request_attempts(requestId, attemptIndex);

CREATE INDEX idx_request_attempts_provider_time
  ON request_attempts(providerId, createdTime);

CREATE INDEX idx_request_attempts_model_time
  ON request_attempts(providerModelId, createdTime);

-- 不带 providerId / providerModelId 的全量统计（提供方排行、模型排行的总量）
-- 只按时间窗取数，需要单独的时间索引。
CREATE INDEX idx_request_attempts_created_time
  ON request_attempts(createdTime);
```

`providerId` 和 `providerModelId` 均不建立外键：历史尝试不依赖 Provider 或 ProviderModel 的当前存在性（配置实体未来可能物理删除）。由于详情页必须在配置删除后仍能展示名称，`request_attempts` 还必须在写入时保存 `providerName`、`providerModelName` 和实际 `url` 快照；ID 仅用于关联和筛选，不得依赖当前配置反查。

`httpStatus`、`retryable`、`upstreamProtocol`、`upstreamTransport`、`ttftMilliseconds` 和两侧规则 id 数组都是稳定的观测字段，必须使用独立列；错误摘要（`errorCode` / `errorMessage`）同理。这张表不再有 `details` 这类协议私有 JSON 列：协议私有的原始报文按视角归入用量表的 `raw` 行，与载荷无关的事实则一律有独立列。`upstreamTransport` 与 `ttftMilliseconds` 都可能为 `NULL`，因为一次尝试可能根本没拿到上游响应（网络错误、请求取消）；此时「不知道」必须与「上游回了 `http`」区分开。规则 id 数组用 JSON 文本保存是因为它们是**集合**而不是标量；它们不是正文，因此不受 `captureRequestContent` 影响。

保留独立列的字段：

- `requestId`；
- `providerId`；
- `providerModelId`；
- `providerName`；
- `providerModelName`；
- `url`；
- `attemptIndex`；
- `status`；
- `upstreamProtocol`；
- `upstreamTransport`；
- `durationMilliseconds`；
- `ttftMilliseconds`；
- `requestRewriteRuleIds`；
- `responseRewriteRuleIds`；
- `httpStatus`；
- `retryable`；
- `errorCode`；
- `createdTime`。

### 3.13 `request_attributes`、`runtime_logs`、`request_rewrite_rules`、`provider_model_request_rewrite_rules` 与 `workflows`

```sql
CREATE TABLE request_attributes (
  requestId TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  createdTime INTEGER NOT NULL,

  PRIMARY KEY (requestId, key),
  FOREIGN KEY (requestId) REFERENCES request_logs(id)
);

CREATE INDEX idx_request_attributes_key_value
  ON request_attributes(key, value);

CREATE INDEX idx_request_attributes_created_time
  ON request_attributes(createdTime);

CREATE TABLE runtime_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX idx_runtime_logs_timestamp
  ON runtime_logs(timestamp);

CREATE INDEX idx_runtime_logs_level_timestamp
  ON runtime_logs(level, timestamp);

CREATE TABLE request_rewrite_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  scope TEXT NOT NULL DEFAULT 'model',
  schemaVersion INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'user',
  match TEXT NOT NULL,
  actions TEXT NOT NULL,
  testCases TEXT NOT NULL DEFAULT '[]',
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER
);

CREATE INDEX idx_request_rewrite_rules_enabled
  ON request_rewrite_rules(enabled);

CREATE INDEX idx_request_rewrite_rules_scope
  ON request_rewrite_rules(scope);

CREATE INDEX idx_request_rewrite_rules_deleted_time
  ON request_rewrite_rules(deletedTime);

CREATE TABLE provider_model_request_rewrite_rules (
  providerModelId TEXT NOT NULL,
  requestRewriteRuleId TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER,

  PRIMARY KEY (providerModelId, requestRewriteRuleId),
  FOREIGN KEY (providerModelId) REFERENCES provider_models(id),
  FOREIGN KEY (requestRewriteRuleId) REFERENCES request_rewrite_rules(id)
);

-- 同一 ProviderModel 下，同一个 priority 只能有一条生效绑定
CREATE UNIQUE INDEX idx_provider_model_request_rewrite_rule_priority_active
  ON provider_model_request_rewrite_rules(providerModelId, priority)
  WHERE deletedTime IS NULL;

CREATE INDEX idx_provider_model_request_rewrite_rules_deleted_time
  ON provider_model_request_rewrite_rules(deletedTime);

CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  definition TEXT NOT NULL,
  createdTime INTEGER NOT NULL,
  updatedTime INTEGER NOT NULL,
  deletedTime INTEGER,

  UNIQUE (type, version)
);

CREATE INDEX idx_workflows_type
  ON workflows(type, deletedTime);

CREATE INDEX idx_workflows_deleted_time
  ON workflows(deletedTime);
```

- `request_attributes` 保存请求的客户端/网络属性（来源 UA、入口地址等）。值一律是字符串——采集侧只产出字符串，因此没有「值类型」维度。
- `runtime_logs` 是应用运行时日志，与配置和请求生命周期无关，按 `timestamp` 保留和清理；日志级别与保留策略见 [observability.md](./observability.md)。
- `request_rewrite_rules` 是可复用的规则定义，`match` 与 `actions` 是 JSON 文本；`provider_model_request_rewrite_rules` 把规则绑定到 ProviderModel，生效顺序由 `priority` 表达。匹配条件、动作语义与四阶段执行次序见 [request-rewrite-rules.md](./request-rewrite-rules.md)。
- `workflows` 按 `type + version` 唯一保存工作流定义，`definition` 是 JSON 文本，`version` 即路由工作台策略图的版本号；`name` 与 `description` 是用户在保存时给这一版写的人类注记，不参与任何运行时判定，也不承担唯一性 ——**版本的身份是 `version` 本身**，同名多版完全正常，两者留空即空串（不会自动填成 `Version N`）。图的节点与端口语义见 [route-design.md](./route-design.md)，执行模型见 [workflow-engine.md](./workflow-engine.md)。

## 4. JSON 文档版本

仅以下 JSON 文档需要 `schemaVersion`：设置中的数组/对象值、协议私有详情、正文 envelope。Provider、LogicalModel、ProviderModel 及端点不再拥有 config JSON，因此不适用 config 文档版本。

```json
{
  "schemaVersion": 1
}
```

读取流程：

```text
数据库文本
  -> JSON.parse
  -> 根据 schemaVersion 升级文档
  -> 当前版本 Zod Schema 校验
  -> 返回领域对象
```

例如 Provider 配置可以演进为：

```text
ProviderConfigV1 -> ProviderConfigV2 -> ProviderConfigV3
```

字段重命名、配置嵌套调整和默认值增加通过文档升级完成，不通过数据库 ALTER TABLE 完成。

## 5. 字段存储决策

### 保留为关系型列

```text
id
providerId
requestId
providerModelId
logicalModelId
status
protocol
attemptIndex
createdTime
updatedTime
deletedTime
durationMilliseconds
```

原因：这些字段用于外键、JOIN、分页、排序、时间过滤、统计和生命周期管理。

### 存入 JSON（严格限制）

```text
settings.value（仅保留真正动态的扩展设置；标准设置必须有独立列）
协议私有且不稳定的原始 usage 字段（按视角存入 `request_usages.rawValue` / `attempt_usages.rawValue`，即 `type = 'raw'` 的行；若开启正文采集，则同时保存在对应 `attempt_contents.responseBody` 的原始响应 envelope 中）
协议私有响应详情和未建模的错误响应
请求/响应正文 envelope（大体积、可选采集）
上游请求/响应正文 envelope（大体积、可选采集）
命中的改写规则 id 集合（`request_attempts.requestRewriteRuleIds` / `responseRewriteRuleIds`）
```

以下内容明确禁止放入 JSON：

```text
Provider name / enabled / timeout / auth type
LogicalModel name / description / enabled / routing strategy
ProviderModel modelName / enabled；scheduling_policies priority / weight / enabled
Provider protocol / URL / ProviderModel endpoint binding / conversion client protocol / enabled
日志 status / protocol / model IDs / provider ID
请求级耗时与传输形态 -> `request_logs.totalDurationMilliseconds` / `request_logs.transport`
Token、缓存 Token 和其他协议用量 -> `request_usages` / `attempt_usages`
上游跳形态、是否发生协议转换、TTFT、命中的改写规则 id -> `request_attempts` 独立列
健康计数、冷却时间和时间戳
```

这些字段要么是产品契约，要么参与路由、关联、排序、筛选或统计，必须由独立列或关系表承载。

## 6. 数据库初始化策略

由于本版本不考虑兼容旧版本，数据库初始化流程保持简单：

1. 创建独立的数据目录；
2. 打开 `one-switch-v<主版本号>.db`（主版本号来自应用版本号，同名文件存在就直接复用）；
3. 启用 SQLite 外键；
4. 切换 WAL 模式；
5. 确认这个库是本版本创建的（`__drizzle_migrations` 与首发基线一致），否则报错退出，不做任何改动；
6. 创建当前版本全部表和索引；
7. 按默认值批量插入 `settings` 配置项（使用 `INSERT OR IGNORE`，仅插入不存在的 key，永不覆盖已有值，保证幂等）；
8. 插入默认逻辑模型；
9. 初始化 Provider 健康状态。

`packages/core/source/database/index.ts` 不再包含以下逻辑：

- 旧表检测（第 5 步只判断「这个库是不是本版本建的」，不认任何具体表名，也不修补任何结构）；
- 旧字段迁移；
- `ensureColumn`；
- `dropColumn`；
- 旧 Provider 宽表转换；
- 旧 Settings 表转换；
- 运行时兼容修补。

旧版数据库由用户自行备份或删除。文件名带主版本号使得正常情况下应用根本不会碰到旧库（旧库在别的文件名下），第 5 步退化成第二道防线，只防「文件被改名、拷错或来自别的分支」这类拿错库的情况。当数据目录里存在其他版本的数据文件时，启动日志会提示这两个文件名，由用户自行备份或删除。

## 7. Store 层边界

Store 层应分为两部分：

### 关系仓储

负责：

- 表记录的创建、查询、更新、删除；
- 外键关系；
- 时间和生命周期；
- 请求日志分页、用量读取和统计；
- `request_usages` / `attempt_usages` 的类型聚合查询，以及 `raw` 行的编解码。

### 文档仓储

负责：

- JSON 序列化和反序列化；
- `schemaVersion` 升级；
- Zod 校验；
- 默认配置合并；
- 文档级更新。

业务层不应直接调用 `JSON.stringify`、`JSON.parse` 或 `json_extract` 读取配置内容。

## 8. 删除与历史数据规则

初始化时必须幂等创建唯一启用的 `logical_models.default` 及其 `scheduling_policies` 默认行；v0.3 MVP 不提供其他逻辑模型的创建、删除和独立策略配置。

### 配置实体

所有配置实体使用软删除（`deletedTime` 非空即视为已删除），因为它们会被历史数据反过来引用：

- `providers`；
- `logical_models`；
- `provider_models`；
- `provider_endpoints`；
- `provider_model_endpoints`；
- `protocol_converters`；
- `scheduling_policies`；
- `request_rewrite_rules` 与 `provider_model_request_rewrite_rules`。

理由很直接：`request_logs` 与 `request_attempts` 里保存的是 `providerId` / `providerModelId` / `logicalModelId` 这类标识。如果配置实体物理删除，历史请求就会指向一个不存在的行——「这条 3 天前的失败请求属于哪个供应商、哪个逻辑模型」将无法回答。历史请求本身仍要按保留策略物理删除（见下文），但它删除的是请求侧的行，不是被引用的配置行。

软删除带来两条配套约束：

1. **唯一约束必须写成部分唯一索引**（`... WHERE deletedTime IS NULL`）。软删除的行留在表里，如果沿用普通 `UNIQUE`，重新添加同一个协议端点、同一对绑定关系会直接撞上历史行而失败。
2. **同一实体重新添加时优先复用仍存在的行**（就地更新并把 `deletedTime` 置空），而不是插入新行；这样 ID 稳定，历史引用不会指向两条语义相同的记录。`scheduling_policies` 的主键是 `(logicalModelId, providerModelId)`，因此它的「复活」天然是主键冲突更新。

### 运行状态

删除 Provider 时，在同一事务中级联：

1. 将 Provider 标记为软删除；
2. 软删除其全部 Provider 模型；
3. 软删除这些模型与 Provider 自身的端点绑定（`provider_model_endpoints`）、端点（`provider_endpoints`）以及二者关联的 `protocol_converters`；
4. 保留 `provider_health` 和各 ProviderModel 的 `provider_model_health`（便于恢复后观察历史健康状态）；若未来提供物理删除，则在同一事务中清理对应健康状态；
5. 保留历史请求日志和远端尝试记录。

### 请求日志

请求日志按保留策略物理删除：

1. 先删除 `attempt_contents`、`attempt_usages`、`request_contents`、`request_usages`、`request_attributes`；
2. 再删除 `request_attempts`；
3. 最后删除 `request_logs`。

顺序不可调换：`attempt_usages` 与 `attempt_contents` 都引用 `request_attempts`，`request_usages` 等引用 `request_logs`，先删父行会直接触发外键约束失败。

历史日志不依赖 `logical_models`、`provider_models` 的当前配置内容。候选模型是运行时根据当前逻辑模型和全局 Provider 模型池计算出来的，不单独持久化绑定关系。

## 9. 本版本明确不采用的方案

### 不采用全局多态 `resources` 表

虽然可以减少表数量，但会导致：

- 关系类型不清晰；
- 外键难以表达；
- 查询条件复杂；
- 类型约束更多依赖应用代码；
- 统计 SQL 可读性变差。

### 不采用全量 EAV 属性表

`key/value` 只用于有明确命名空间、Schema 和默认值管理的全局应用配置，不扩展到所有业务实体。Provider、模型和路由核心配置仍使用经过 Schema 校验的 JSON 文档，避免用通用属性表承载复杂嵌套结构。

### 不把健康状态写进配置 JSON

健康状态更新频繁，且和用户配置的生命周期、事务边界、更新频率完全不同。

### 不把所有日志字段都放入 JSON

状态、协议、时间、耗时和关联标识需要被分页、过滤和聚合，必须保持为独立列。

## 10. 实施清单

本版本落地时需要同步修改：

1. `packages/core/source/database/schema.ts`；
2. `packages/core/source/database/index.ts`；
3. `packages/core/source/database/provider-store.ts`、`model-store.ts`、`logical-model-store.ts`、`settings-store.ts`、`health-store.ts`、`request-log-store.ts`、`analytics-store.ts`；
4. `packages/contracts/source/schemas.ts`；
5. `packages/core/source/database/development-seed.ts`；
6. `packages/core/source/database/index.test.ts`；
7. 分域 Store 测试（`store-boundaries.test.ts`、各领域测试）；
8. 供应商包导入导出逻辑（`packages/core/source/management/provider-transfer/`、`packages/contracts/source/provider-bundle.ts`）；
9. Provider、模型、路由和统计相关 SQL；
10. 删除旧版 Drizzle 迁移文件，生成新的首发基线；
11. 数据文件名规则（`packages/contracts/source/database-file.ts`）及其在 `apps/app/source/index.ts`、`packages/core/source/index.ts`、`packages/core/source/runtime/server-runtime.ts`、`packages/core/source/database/index.ts` 之间的传递；测试统一使用 `packages/core/source/database/test-support.ts` 里的固定文件名。

## 11. 后续演进建议（评审补充）

以下建议尚未定稿，按优先级排列，供后续迭代评审时决策。已定稿的决策（表名统一为 `settings`、`captureStatus` 枚举、时间戳毫秒、日志快照冗余、`provider_health` 与 `provider_model_health` 清理时机、转换事实并入 `request_attempts` 而不单独建表、正文按视角拆表（`request_contents` / `attempt_contents`，以 `attemptId` 唯一关联尝试）、用量按视角拆表（`request_usages` / `attempt_usages`）、`request_attempts` 去除 Provider 外键、唯一约束与 CHECK 约束、删除 `settings.version`、数据文件名带应用主版本号（`one-switch-v<主版本>.db`））已落入正文各章。

### 11.1 待产品决策

**`request_contents` 的正文展示降级。**
正文不限制大小，但单个请求的尝试次数可能很多（重试风暴）。建议约定：按实际尝试次数完整保存数组项，但每次尝试的正文若超过某个“展示友好”阈值（如 1MB），可在 envelope 中降级为 `bodyPreview` + `bodyOmitted: true`，这不是存储限制，而是防止单行 JSON 过大导致 UI 无法渲染。

**按供应商筛选日志的实现方式。**
日志页按供应商筛选目前靠 `request_attempts` 的 JOIN，因为 `request_attempts.providerId` 上是真正可索引的列，且一次请求可能尝试过多个供应商，请求级无法表达这个集合。若未来出现明确的高频需求，可考虑在 `request_logs` 上增加一个明确语义的派生列（例如「最终成功供应商」），但**不得**用无法索引的 JSON 快照代替。

### 11.2 可延后但建议预留

**`request_contents` 独立分页查询。**
正文表体积远大于日志表。若未来提供“仅浏览有正文的日志”视图，`request_contents` 上的 `requestId IN (...)` 查询即可满足；暂不需要额外反向索引。

**JSON 文档升级函数的注册机制。**
第 4 节描述了 `V1 -> V2 -> V3` 升级链，建议实现时采用显式注册表（`{ 1: upgradeToV2, 2: upgradeToV3 }`）而非 if-else 链，便于测试每个升级步骤。

**WAL checkpoint 与应用退出。**
本地桌面应用退出时建议执行 `PRAGMA wal_checkpoint(TRUNCATE)`，避免残留过大的 WAL 文件；这属于实现细节，但值得写入 desktop spec。

## 12. 最终结论

本版本的核心结构是：

```text
身份、关系、枚举、开关、数值和查询字段 -> 关系型列
多值且有独立生命周期的内容             -> 关系子表
全局标准配置                           -> settings 的明确列或明确 key
运行时状态                             -> 独立状态表
稳定日志维度与常用统计                 -> 关系型列
协议私有原始详情与大体积正文             -> JSON / TEXT
```

以后新增字段时，先判断它是否参与路由、查询、排序、关联、统计或产品展示：若是，新增明确列/子表；只有开放性扩展或协议原始数据才进入 JSON。JSON Schema 不能成为逃避数据库建模的理由。
