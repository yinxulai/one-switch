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

**事实永远写入，载荷才受开关控制。** `captureRequestContent` 只决定是否保存正文；是否发生协议转换、是否流式、命中的改写规则 id、尝试耗时、TTFT 都是事实，无论开关如何都必须落库。因此它们写在 `request_attempts` 上，而不写在与正文同生命周期的表里。

**协议转换是派生事实，不单独建表。** `request_logs.clientProtocol` 与 `request_attempts.upstreamProtocol` 不相等，就是「发生了转换」的唯一判据；`request_attempts.streaming` 给出是否流式；耗时直接读 `request_attempts.durationMilliseconds`。三者合并后没有任何独立信息，单独建表只会引入一份会漂移的耗时副本。

指标与用量表不重复保存同一数值：Token、缓存 Token 和其他协议用量进入 `request_usages` / `attempt_usages`；总耗时落在 `request_logs.totalDurationMilliseconds`，缓存命中由 `request_usages.cachedInputTokens > 0` 现算，都不再另存一份。

**没有独立的指标 KV 表。** 请求级事实只有两种命运：它要么是**稳定列**（如 `totalDurationMilliseconds`、`streaming`），要么是**某个视角的用量行**（如 `type = 'raw'` 的原始报文行）。一张通用 `(requestId, key, value)` 指标表能表达的每一条数据都属于这两类，却同时失去类型约束与 CHECK 保护，因此不再保留。

## 请求日志展示视图

### 请求列表

| 展示字段 | 数据来源 | 说明 |
| --- | --- | --- |
| id | `request_logs.id` | 请求唯一 ID |
| createdTime | `request_logs.createdTime` | Unix 毫秒时间戳 |
| clientProtocol | `request_logs.clientProtocol` | 客户端协议；协议无法识别时为 `null` |
| streaming | `request_logs.streaming` | 客户端是否以流式方式发起本次请求 |
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
| 转换详情 | `request_logs` + `request_attempts` | 直接对比两侧协议得出「客户端协议 → 上游协议」，是否流式读 `request_attempts.streaming`，耗时读 `request_attempts.durationMilliseconds` |

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
| streaming | `request_attempts.streaming` | 本次尝试是否使用了流式传输 |
| durationMilliseconds | `request_attempts.durationMilliseconds` | 本次尝试耗时 |
| ttftMilliseconds | `request_attempts.ttftMilliseconds` | 本次尝试的首 token 延迟；未观测到时为空 |
| requestRewriteRuleIds | `request_attempts.requestRewriteRuleIds` | 本次尝试请求阶段命中的改写规则 id |
| responseRewriteRuleIds | `request_attempts.responseRewriteRuleIds` | 本次尝试响应阶段命中的改写规则 id |
| errorCode | `request_attempts.errorCode` | 结构化错误码 |
| errorMessage | `request_attempts.errorMessage` | 错误摘要 |
| switched | 服务层派生 | `attemptIndex > 0` 或后续存在尝试时，表示发生过队列切换 |
| url | `request_attempts.url` | 写入时的实际 URL 快照，不能从当前配置反推 |

### 日志策略

- 默认保留最近 N 条请求（如 1000 条），可配置
- 支持设置保留天数，自动清理指定天数之前的请求日志；也支持在设置页立即执行清理
- 默认保存完整请求体和响应体；用户可显式关闭“记录请求内容”，关闭后不再采集新正文
- 记录客户端原始请求与最终响应（`request_contents`），以及每次 upstream 尝试的请求/响应（`attempt_contents`）。
- 协议转换不单独存储：展示时直接比较 `request_logs.clientProtocol` 与 `request_attempts.upstreamProtocol`，是否流式读 `request_attempts.streaming`，耗时读 `request_attempts.durationMilliseconds`。转换前后的 Header 与正文分别由 `request_contents`（客户端侧）与 `attempt_contents`（上游侧）唯一提供。upstream 可以是供应商，也可以是协议转换器所在的中间目标。
- **被拒的请求同样落库。** 协议无法识别、model 非法、没有可用逻辑模型、手动模型不可用、找不到上游目标、客户端中断——这些分支在建立执行上下文之前就返回了，但它们是用户真实发出的请求。不写日志会让「日志里查不到」被误读成「没发过这个请求」。
- 正文与请求日志索引分开存储；单次正文不设置大小限制并完整读取、保存，以支持超长上下文和大体积请求。极大正文可能增加内存和数据库占用，但不应因日志记录失败影响代理请求。
- 日志清理依次删除 `attempt_contents`、`attempt_usages`、`request_contents`、`request_usages`、`request_attributes`、`request_attempts`，最后删除 `request_logs`。
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

### 额度处理（P1）

- 支持"手动额度阈值"：用户可为供应商设置周期请求数上限
- 支持手动标记额度耗尽
- 达到阈值后供应商自动降级，并在菜单栏/控制台提示
- 自动读取供应商真实余额不作为 MVP（各供应商接口差异大）

## 健康状态与冷却

### 健康状态

每个 Provider 和每个 ProviderModel 都维护独立的运行时健康状态。路由时必须同时检查两层冷却。

Provider 维护：

- 连续失败次数
- 冷却截止时间
- 最近成功时间
- 最近失败时间

### 冷却规则

- 连续失败达到阈值后进入短期冷却
- 默认冷却时间：30 秒 ~ 5 分钟，可按错误类型区分
- Provider 冷却期间跳过该 Provider 下的所有 ProviderModel；ProviderModel 冷却期间只跳过对应模型
- 冷却结束后允许下一次真实请求探测恢复
- 成功请求后连续失败计数重置

### 恢复策略

- MVP 不做主动健康探测
- 使用真实流量驱动状态恢复（冷却结束后的第一次请求作为探测）
- P2 可加入主动健康探测
