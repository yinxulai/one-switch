# 可观测性

本文描述运行诊断日志与请求观测数据的职责。请求日志展示字段不等同于单张数据库表字段；没有直接存储的字段由服务层根据关联表推导。

## 运行诊断日志

运行日志使用 `debug`、`info`、`warn`、`error` 四个级别：

| 级别 | 使用场景 | 示例 |
| --- | --- | --- |
| `debug` | 高频、预期且仅用于深入排障的细节 | API 请求开始/完成、CORS 预检、重复启动被跳过、客户端取消 |
| `info` | 生命周期状态变化或用户主动触发且成功的操作 | 服务监听、数据库初始化、代理启动/停止、更新检查与下载 |
| `warn` | 可恢复异常、客户端/配置问题、将继续重试的失败 | 4xx、无可用模型、单次上游失败、状态轮询首次失败 |
| `error` | 操作最终失败、5xx、资源初始化/关闭失败或候选全部耗尽 | 服务监听失败、数据库失败、所有 Provider 失败、未捕获异常 |

日志必须包含足以关联问题的模块、阶段、错误码、请求 ID、目标标识或耗时；不得输出 API Key、Authorization、Cookie、完整代理凭据、请求/响应正文或原始设置值。高频轮询错误仅记录首次失败及恢复，避免重复刷屏。一次故障只在最具上下文的边界记录为 `error`，中间可恢复步骤不得提前升级为 `error`。

## 请求观测数据分层

| 层 | 数据表 | 职责 |
| --- | --- | --- |
| 请求汇总 | `request_logs` | 请求身份、客户端协议、是否流式、逻辑模型标识、状态、总耗时和创建时间 |
| 请求用量 | `request_usages` | 请求级 Token/用量明细，包括 `type = 'raw'` 的原始报文行 |
| 请求尝试 | `request_attempts` | 每次候选模型尝试、故障转移顺序、upstream 协议与结果，以及是否流式、TTFT、两侧命中的改写规则 id |
| 尝试用量 | `attempt_usages` | 单次尝试级的 Token/用量明细，包括 `type = 'raw'` 的原始报文行 |
| 客户端正文 | `request_contents` | 按需保存**客户端视角**的请求与最终响应，一个请求一行 |
| 上游正文 | `attempt_contents` | 按需保存**上游视角**的请求与响应，一次尝试一行 |

**一张表 = 一个视角。** 列名不带视角前缀——视角由表名唯一确定。
客户端发来的请求与最终收到的响应只写入 `request_contents`；真正发给 Provider 的请求与 Provider 返回的响应只写入 `attempt_contents`（关联 `attemptId`）。用量同样按视角拆：`request_usages`（请求级）与 `attempt_usages`（尝试级），主键分别是 `(requestId, type)` 与 `(attemptId, type)`，**不存在用可空列判别归属的行**。新增一个观测视角时新增一张表，而不在已有列上叠含义。

**事实永远写入，载荷才受开关控制。** `captureRequestContent` 只决定是否保存正文；是否发生协议转换、上游跳以什么形态作答、命中的改写规则 id、尝试耗时、TTFT 都是事实，无论开关如何都必须落库。因此它们写在 `request_attempts` 上，而不写在与正文同生命周期的表里。而“客户端要的是整包还是增量”是请求刚一进来就已经定下的**预期**，它与请求日志同生命周期，写在 `request_logs.transport` 上。

**协议转换是派生事实，不单独建表。** `request_logs.clientProtocol` 与 `request_attempts.upstreamProtocol` 不相等，就是「发生了转换」的唯一判据；上游跳以什么形态作答读 `request_attempts.upstreamTransport`；耗时直接读 `request_attempts.durationMilliseconds`。三者合并后没有任何独立信息，单独建表只会引入一份会漂移的耗时副本。

指标与用量表不重复保存同一数值：Token、缓存 Token 和其他协议用量进入 `request_usages` / `attempt_usages`；总耗时落在 `request_logs.totalDurationMilliseconds`，缓存命中由 `request_usages.cachedInputTokens > 0` 现算，都不再另存一份。

**没有独立的指标 KV 表。** 请求级事实只有两种命运：它要么是**稳定列**（如 `totalDurationMilliseconds`），要么是**某个视角的用量行**（如 `type = 'raw'` 的原始报文行）。一张通用 `(requestId, key, value)` 指标表能表达的每一条数据都属于这两类，却同时失去类型约束与 CHECK 保护，因此不再保留。

## 请求日志展示视图

### 请求列表

| 展示字段 | 数据来源 | 说明 |
| --- | --- | --- |
| id | `request_logs.id` | 请求唯一 ID |
| createdTime | `request_logs.createdTime` | Unix 毫秒时间戳 |
| clientProtocol | `request_logs.clientProtocol` | 客户端协议；协议无法识别时为 `null` |
| transport | `request_logs.transport` | 客户端跳的传输形态（`http` / `http-stream` / `websocket`），即“字节怎么回来”的预期 |
| logicalModelId | `request_logs.logicalModelId` | 逻辑模型 ID；尚未解析到时为 `null` |
| status | `request_logs.status` | `pending`、`success`、`failed` 或 `cancelled` |
| durationMilliseconds | `request_logs.totalDurationMilliseconds` | 从收到请求到写完响应的总耗时 |
| ttftMilliseconds | `request_attempts` 派生 | 取该请求所有尝试 `ttftMilliseconds` 的最小值；无样本时为空。不落库，避免出现会漂移的第二份首字延迟 |
| attemptCount | `request_attempts` | 按 `requestId` 汇总尝试数量 |
| contentCaptured | `request_contents.captureStatus` | 由正文记录状态派生 |

### 请求详情

请求详情由 `request_logs` 及其关联数据组合而成：

| 展示区域 | 数据来源 | 说明 |
| --- | --- | --- |
| 请求摘要 | `request_logs` | 请求身份、客户端协议、逻辑模型和最终状态 |
| 总耗时与缓存命中 | `request_logs` / `request_usages` | 总耗时读 `request_logs.totalDurationMilliseconds`；缓存命中由缓存用量现算 |
| 首字延迟 | `request_attempts` 派生 | 取所有尝试 `ttftMilliseconds` 的最小值；尝试级样本本身留在 `request_attempts` |
| Token 与其他用量 | `request_usages` / `attempt_usages` | 请求级与尝试级分开，不混口径 |
| Provider 尝试 | `request_attempts` | 按 `attemptIndex` 排序展示 |
| 客户端请求 / 最终响应 | `request_contents` | 客户端视角，一个请求一行 |
| 发送到上游的请求 / 真实上游响应 | `attempt_contents` | 上游视角，按 `attemptId` 对应到具体尝试 |
| 已应用修改器 | `request_attempts` | `requestRewriteRuleIds` ∪ `responseRewriteRuleIds`；事实不随正文采集开关丢失 |
| 转换详情 | `request_logs` + `request_attempts` | 直接对比两侧协议得出「客户端协议 → 上游协议」，上游跳以什么形态作答读 `request_attempts.upstreamTransport`，耗时读 `request_attempts.durationMilliseconds` |

## Provider 尝试视图

`request_attempts` 是关系表，不是 `request_logs` 中的嵌套字段。详情 API 可将其组装为以下展示对象：

| 展示字段 | 数据来源 | 说明 |
| --- | --- | --- |
| id | `request_attempts.id` | 尝试唯一 ID |
| attemptIndex | `request_attempts.attemptIndex` | 请求内尝试顺序，从 0 开始 |
| providerId | `request_attempts.providerId` | Provider 快照标识 |
| providerModelId | `request_attempts.providerModelId` | ProviderModel 快照标识 |
| providerName | `request_attempts.providerName` | 写入时的 Provider 名称快照 |
| providerModelName | `request_attempts.providerModelName` | 写入时的 ProviderModel 名称快照 |
| upstreamProtocol | `request_attempts.upstreamProtocol` | 本次 attempt 实际使用的 upstream 协议 |
| upstreamRequestId | `request_attempts.upstreamRequestId` | 当前 upstream 返回的请求标识 |
| httpStatus | `request_attempts.httpStatus` | 当前 upstream HTTP 状态码；网络错误时为空 |
| status | `request_attempts.status` | 本次尝试结果 |
| retryable | `request_attempts.retryable` | 是否允许切换到下一个候选 |
| upstreamTransport | `request_attempts.upstreamTransport` | 上游跳本次尝试以什么形态作答；未拿到响应（如连不上）时为 `null` |
| durationMilliseconds | `request_attempts.durationMilliseconds` | 本次尝试耗时 |
| ttftMilliseconds | `request_attempts.ttftMilliseconds` | 本次尝试的首 token 延迟；未观测到时为空 |
| requestRewriteRuleIds | `request_attempts.requestRewriteRuleIds` | 本次尝试请求阶段命中的改写规则 id |
| responseRewriteRuleIds | `request_attempts.responseRewriteRuleIds` | 本次尝试响应阶段命中的改写规则 id |
| errorCode | `request_attempts.errorCode` | 结构化错误码 |
| errorMessage | `request_attempts.errorMessage` | 错误摘要 |
| switched | 服务层派生 | `attemptIndex > 0` 或后续存在尝试时，表示发生过上游模型切换 |
| url | `request_attempts.url` | 写入时的实际 URL 快照，不能从当前配置反推 |

### 日志策略

采集与保留是**两个正交的维度**，各有自己的开关与时间窗，四个设置项一一对应：

| 维度 | 采集开关 | 自动保留 | 默认 |
|------|----------|----------|------|
| 请求日志（请求身份、逐次尝试、用量与指标） | `captureRequestLogs`（默认开） | `requestLogRetentionDays` | **`0` = 永久保留** |
| 请求与响应正文（客户端与上游两个视角） | `captureRequestContent`（默认开） | `contentRetentionDays` | **7 天** |

- **`0` 表示永久保留，不是「零天」。** 输入框里的 `0` 会把单位位置换成「永久」，避免被读成「马上删除」。默认值刻意不对称：指标行很小、且是历史统计与故障回溯的唯一来源，永久保留；正文会随请求长度线性膨胀，过期正文留 7 天就够了。
- **正文开关失效于日志开关**：关掉 `captureRequestLogs` 后新请求只走代理链路、不落库，正文行也随之无处归属。关掉采集**不会**自动删除已有数据，删除只由保留策略与手动清理负责。
- **正文过期只删正文。** `contentRetentionDays` 到期只删 `request_contents` 与 `attempt_contents`（协议转换前后的两个视角一起删），`request_logs`、`request_attempts` 与 `request_usages` / `attempt_usages` 全部保留：历史用量与延迟统计不会因为正文被清理而失真。
- **请求日志过期是级联删除。** `requestLogRetentionDays` 到期依次删除 `attempt_contents`、`attempt_usages`、`request_contents`、`request_usages`、`request_attributes`、`request_attempts`，最后删除 `request_logs`，不留孤儿行。
- 没有「保留最近 N 条」的条数上限：清理口径只有一个，即时间窗。
- **手动清理与自动保留是两回事。** 设置页的“清理历史日志”可以分别输入「请求日志保留天数」和「请求响应正文保留天数」，即刻执行一次、不改动自动保留设置；单项填 `0` 表示本次跳过该项，两项都是 `0` 时不执行。接口 `PruneRequestLogsParams`（`requestLogRetentionDays?` / `contentRetentionDays?`）返回 `{ deletedLogs, deletedContents }`，两个数量分别对应两条删除路径。
- **删除后的展示不能变形。** 正文被清理的记录仍是完整的一条请求记录，详情面板显式提示“正文已按保留策略清理”，而不是显示成空正文；列表、统计与分页在正文缺失时保持同一套布局。
- 默认保存完整请求体和响应体；关闭 `captureRequestContent` 后不再采集新正文
- 记录客户端原始请求与最终响应（`request_contents`），以及每次 upstream 尝试的请求/响应（`attempt_contents`）。
- 协议转换不单独存储：展示时直接比较 `request_logs.clientProtocol` 与 `request_attempts.upstreamProtocol`，上游跳以什么形态作答读 `request_attempts.upstreamTransport`，耗时读 `request_attempts.durationMilliseconds`。转换前后的 Header 与正文分别由 `request_contents`（客户端侧）与 `attempt_contents`（上游侧）唯一提供。upstream 可以是供应商，也可以是协议转换器所在的中间目标。
- **被拒的请求同样落库。** 协议无法识别、model 非法、没有可用逻辑模型、手动模型不可用、找不到上游目标、客户端中断——这些分支在建立执行上下文之前就返回了，但它们是用户真实发出的请求。不写日志会让「日志里查不到」被误读成「没发过这个请求」。
- 正文与请求日志索引分开存储；单次正文不设置大小限制并完整读取、保存，以支持超长上下文和大体积请求。极大正文可能增加内存和数据库占用，但不应因日志记录失败影响代理请求。
- 日志清理依次删除 `attempt_contents`、`attempt_usages`、`request_contents`、`request_usages`、`request_attributes`、`request_attempts`，最后删除 `request_logs`；只清理正文时仅走 `request_contents` / `attempt_contents` 这一步
- Authorization、API Key、Cookie 等敏感请求头始终脱敏，正文自身不视为已脱敏
- 日志存储在本地应用数据目录
- 支持日志导出（JSON 格式），正文默认不包含在导出文件中

### 请求内容查看

- 请求日志列表中的每条记录提供“查看详情”入口
- 使用 Drawer 或 Dialog 展示完整请求/响应内容，不离开当前日志列表
- 详情按「客户端请求」「发送到上游的请求」「真实上游响应」「最终客户端响应」四个阶段展示，每个阶段的数据来源在表层面就已经唯一确定
- 有协议转换时，转换信息以「客户端协议 → 上游协议」标注展示，并复用上述四个阶段的正文，不额外渲染第三份载荷
- JSON 正文提供格式化、折叠和复制能力；文本、SSE 事件使用等宽文本查看器
- 未开启内容记录时，在详情中明确显示状态和原因

## 用量统计

### 基础统计

- 总请求数
- 成功数 / 失败数
- 失败切换次数
- 各 Provider 调用次数：按 `request_attempts.providerId` 统计。
- 各协议调用次数：客户端协议按 `request_logs.clientProtocol` 统计，upstream 协议按 `request_attempts.upstreamProtocol` 统计。
- 平均响应时间：聚合 `request_logs.totalDurationMilliseconds`。
- Token 和其他用量：请求级聚合 `request_usages`，尝试级聚合 `attempt_usages`，不得把两级混成同一个口径。
- 延迟分布与 TTFT：TTFT 是**尝试级样本**，聚合 `request_attempts.ttftMilliseconds` 并按 `request_attempts.providerId` 归属到真正产生的供应商；不得先把一次请求的多次尝试平均成「请求级 TTFT」再比对。

### 分析页聚合查询设计

分析页在渲染层每 15 秒轮询一次，因此这些查询的耗时直接决定页面是「一直在加载」还是「随时可用」。在 15 万请求 / 30 万尝试的真实规模下实测（`request_logs` 15 万行、`request_attempts` 30 万行、两张用量表各 45 万行），得到三条必须遵守的结论。

**一、一请求多行的表必须先按请求聚合，再连接回去，不能逐请求回查。**

`request_attributes`（一请求两行）、`request_usages` / `attempt_usages`（一请求或一尝试五行）都是「实体 × 类型」的窄表。**在主表上写相关子查询是反面写法**：

```sql
SELECT coalesce((SELECT value FROM request_attributes a WHERE a.requestId = r.id AND a.key = 'request.source'), 'unknown')
FROM request_logs r WHERE r.createdTime >= ?
```

主表有多少行就回查多少次：30 天窗口下 `getRequestSourceStats` 要 1016 ms，而「先在窄表里按 `requestId` / `attemptId` 分组聚成一行，再 `LEFT JOIN` 回主表」只要 432 ms；同一改动用在用量透视上，`getUsageTrend` 从 547 ms 降到 294 ms。

透视列要显式列出（`sum(case when type = 'inputTokens' ...).as('inputTokens')` 写五遍），不要在运行时循环拼接：列集合必须是静态已知的字段。

**二、先按自己表的时间列收窄，再去连别的表。**

`request_attempts` 与它所属的 `request_logs` 之间没有时间差——尝试的 `createdTime` 必然不早于请求的 `createdTime`，因此「请求落在窗口内」与「尝试落在窗口内」是同一批尝试。但规划器只能用后者：

```sql
-- 慢：按请求表过滤，尝试表只能靠 providerId 索引把该供应商的全部历史捞出来
SELECT ... FROM request_attempts a JOIN request_logs r ON a.requestId = r.id
WHERE r.createdTime >= ? GROUP BY a.providerId
-- 等价但快：直接命中 (providerId, createdTime)
SELECT ... FROM request_attempts a
WHERE a.createdTime >= ? GROUP BY a.providerId
```

`getProviderStats` 因此是 117 ms 而不是 366 ms（30 天）。`getModelStats` 除了用量之外没有任何指标来自请求表，那个 `JOIN request_logs` 本就不必要。

**三、能在 SQL 里分桶就不要把样本搬进内存。**

`getLatencyDistribution` 若取回窗口内每一个 TTFT 到 JS 里排序分桶，就是「为一张直方图搬运并排序十几万个整数」；在 SQL 里 `CASE ... END AS bucket` + `GROUP BY bucket` 后，返回行数从样本数（30 天 12.7 万行）降到桶数（最多 8 行）。实测耗时只是小幅领先（同一进程内交替测量两轮、每轮取三次最小值：7 天 25.1 ms vs 30.2 ms，30 天 117.9 ms vs 125.1 ms），真正的收益是把「搬运并排序全部样本」从查询里去掉：返回量不再随时间窗增长。

**但「时间窗下推到自己的时间列」这条经验不能无条件套用。** 延迟分布的时间窗必须留在 `request_logs.createdTime` 上：它的过滤条件里还有请求级状态 `request_logs.status = 'success'`，把时间窗下推到 `request_attempts.createdTime` 后，规划器只能用 `idx_request_logs_status_created_time` 的状态列、丢掉时间范围，7 天窗口实测从 25 ms 恶化到 106 ms。成立条件是「这张表的时间列索引能被独立使用」——用量与尝试统计的过滤条件全在尝试表上，所以它们适用；延迟分布不适用。

**索引要逐条论证，不能一次加满。** 一次性加上四个「看起来该有」的索引后，多数查询耗时持平，`getModelStats` 反而从 136 ms 涨到 306 ms（7 天）、`getLatencyDistribution` 从 23 ms 涨到 333 ms（30 天）——规划器被多出来的选项带到了更差的路径上。下表是实测确认保留的三个：

| 索引 | 服务什么 | 为什么必须这样 |
| --- | --- | --- |
| `idx_request_logs_status_created_time(status, createdTime)` | 失败原因分布、成功率 | 只有 `status` 时，SQLite 会先把该状态的全部历史行找出来再逐行比对时间，代价与时间窗无关 |
| `idx_request_attempts_created_time(createdTime)` | 不带供应商/模型条件的全量统计 | `(providerId, createdTime)` 与 `(providerModelId, createdTime)` 的最左列都不是时间，服务不了全量排行 |
| `idx_request_usages_created_time` / `idx_attempt_usages_created_time` | 用量聚合 | 过滤条件永远只有时间窗（五种类型总是一起取），`(type, createdTime)` 的最左列用不上 |

**连接与 PRAGMA 层面的调优同样重要。** `initDatabase` 设定 `temp_store = MEMORY`（聚合的 `GROUP BY` / `ORDER BY` 临时 B 树不再落盘）、`cache_size = -64000`（默认页缓存仅 2 MB，扫一遍日志表就被冲干净）、`synchronous = NORMAL`（WAL 下不会因进程崩溃丢已提交数据），并在迁移后执行一次 `PRAGMA optimize` 让规划器拿到统计信息——没有统计信息时它按「所有索引一样好」估计，实测正是这一点让它给带时间窗的聚合选了更差的路径。

结果：分析页一次完整加载从 1403 ms 降到 550 ms（7 天）、从 3088 ms 降到 1479 ms（30 天）；供应商详情页 30 天从 744 ms 降到 206 ms。

### 额度处理（未实现，规划项）

当前没有任何「额度」概念：路由候选过滤只依据启用开关与两层健康冷却，供应商与逻辑模型上都没有周期请求数或额度字段，代码里也不存在相关的降级分支。以下内容仅仅是尚未开始的规划。

- 支持"手动额度阈值"：用户可为供应商设置周期请求数上限
- 支持手动标记额度耗尽
- 达到阈值后供应商自动降级，并在菜单栏/控制台提示
- 自动读取供应商真实余额不作为 MVP（各供应商接口差异大）

## 健康状态与冷却

Provider 与 ProviderModel 两层健康状态的字段定义、索引与保留规则见 [data-model.md](./data-model.md) §3.8；两层冷却如何参与候选过滤与故障转移见 [proxy-engine.md](./proxy-engine.md)。

- 连续失败达到 `consecutiveFailureThreshold`（默认 3）后进入冷却
- 冷却从 `cooldownBaseSeconds`（默认 30 秒）起算，上限 `cooldownMaxSeconds`（默认 300 秒）
- Provider 冷却期间跳过该 Provider 下的所有 ProviderModel；ProviderModel 冷却期间只跳过对应模型
- 冷却结束后允许下一次真实请求探测恢复；成功后连续失败计数重置
- MVP 不做主动健康探测，用真实流量驱动状态恢复
