import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** 允许写入 `request_usages` / `attempt_usages` 的用量类型，避免出现无意义的透视键。 */
const USAGE_TYPE_VALUES = "'inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'reasoningTokens', 'raw'"

/** 请求的状态取值。尝试另有 {@link ATTEMPT_STATUS_VALUES}——尝试不存在 `pending`。 */
const REQUEST_STATUS_VALUES = "'pending', 'success', 'failed', 'cancelled'"

/** 尝试的状态取值。尝试行只在拿到结果后写入，「还没有结果」由没有行表达。 */
const ATTEMPT_STATUS_VALUES = "'success', 'failed', 'cancelled'"

export const settings = sqliteTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    valueType: text('valueType').notNull().default('string'),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [index('idx_settings_updated_time').on(table.updatedTime)],
)

export const providers = sqliteTable(
  'providers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    index('idx_providers_enabled').on(table.enabled),
    index('idx_providers_deleted_time').on(table.deletedTime),
  ],
)

export const providerHealth = sqliteTable('provider_health', {
  providerId: text('providerId').primaryKey().references(() => providers.id),
  consecutiveFailures: integer('consecutiveFailures').notNull().default(0),
  cooldownUntilTime: integer('cooldownUntilTime'),
  lastSuccessTime: integer('lastSuccessTime'),
  lastFailureTime: integer('lastFailureTime'),
  updatedTime: integer('updatedTime').notNull(),
})

export const providerSettings = sqliteTable(
  'provider_settings',
  {
    providerId: text('providerId').notNull().references(() => providers.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
    valueType: text('valueType').notNull().default('string'),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    primaryKey({ columns: [table.providerId, table.key] }),
    index('idx_provider_settings_key').on(table.key),
  ],
)

export const providerEndpoints = sqliteTable(
  'provider_endpoints',
  {
    id: text('id').primaryKey(),
    providerId: text('providerId').notNull().references(() => providers.id),
    protocol: text('protocol').notNull(),
    url: text('url').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    // 同一供应商同一协议只允许一条**未删除**的端点：软删除的行留在表里，
    // 因此唯一约束必须是部分索引，否则重新添加同一协议会撞上历史行。
    uniqueIndex('idx_provider_endpoints_provider_protocol_active')
      .on(table.providerId, table.protocol)
      .where(sql`deletedTime IS NULL`),
    index('idx_provider_endpoints_protocol').on(table.protocol, table.enabled),
    index('idx_provider_endpoints_deleted_time').on(table.deletedTime),
  ],
)

export const providerModels = sqliteTable(
  'provider_models',
  {
    id: text('id').primaryKey(),
    providerId: text('providerId').notNull().references(() => providers.id),
    modelName: text('modelName').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    uniqueIndex('idx_provider_models_provider_model_active')
      .on(table.providerId, table.modelName)
      .where(sql`deletedTime IS NULL`),
    index('idx_provider_models_enabled').on(table.providerId, table.enabled, table.deletedTime),
  ],
)

export const providerModelHealth = sqliteTable('provider_model_health', {
  providerModelId: text('providerModelId').primaryKey().references(() => providerModels.id),
  consecutiveFailures: integer('consecutiveFailures').notNull().default(0),
  cooldownUntilTime: integer('cooldownUntilTime'),
  lastSuccessTime: integer('lastSuccessTime'),
  lastFailureTime: integer('lastFailureTime'),
  updatedTime: integer('updatedTime').notNull(),
})

export const providerModelEndpoints = sqliteTable(
  'provider_model_endpoints',
  {
    id: text('id').primaryKey(),
    providerModelId: text('providerModelId').notNull().references(() => providerModels.id),
    providerEndpointId: text('providerEndpointId').notNull().references(() => providerEndpoints.id),
    url: text('url'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    uniqueIndex('idx_provider_model_endpoints_unique_active')
      .on(table.providerModelId, table.providerEndpointId)
      .where(sql`deletedTime IS NULL`),
    index('idx_provider_model_endpoints_provider_endpoint').on(table.providerEndpointId, table.enabled),
    index('idx_provider_model_endpoints_deleted_time').on(table.deletedTime),
  ],
)

export const requestRewriteRules = sqliteTable('request_rewrite_rules', {
  id: text('id').primaryKey(), name: text('name').notNull(), description: text('description').notNull().default(''), enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true), scope: text('scope').notNull().default('model'), schemaVersion: integer('schemaVersion').notNull().default(1), source: text('source').notNull().default('user'), match: text('match').notNull(), actions: text('actions').notNull(), testCases: text('testCases').notNull().default('[]'), createdTime: integer('createdTime').notNull(), updatedTime: integer('updatedTime').notNull(), deletedTime: integer('deletedTime'),
}, table => [index('idx_request_rewrite_rules_enabled').on(table.enabled), index('idx_request_rewrite_rules_scope').on(table.scope), index('idx_request_rewrite_rules_deleted_time').on(table.deletedTime)])

export const providerModelRequestRewriteRules = sqliteTable('provider_model_request_rewrite_rules', {
  providerModelId: text('providerModelId').notNull().references(() => providerModels.id), requestRewriteRuleId: text('requestRewriteRuleId').notNull().references(() => requestRewriteRules.id), priority: integer('priority').notNull(), enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true), createdTime: integer('createdTime').notNull(), updatedTime: integer('updatedTime').notNull(), deletedTime: integer('deletedTime'),
}, table => [
  primaryKey({ columns: [table.providerModelId, table.requestRewriteRuleId] }),
  uniqueIndex('idx_provider_model_request_rewrite_rule_priority_active').on(table.providerModelId, table.priority).where(sql`deletedTime IS NULL`),
  index('idx_provider_model_request_rewrite_rules_deleted_time').on(table.deletedTime),
])

export const protocolConverters = sqliteTable(
  'protocol_converters',
  {
    id: text('id').primaryKey(),
    providerModelEndpointId: text('providerModelEndpointId').notNull().references(() => providerModelEndpoints.id),
    clientProtocol: text('clientProtocol').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    uniqueIndex('idx_protocol_converters_unique_active')
      .on(table.providerModelEndpointId, table.clientProtocol)
      .where(sql`deletedTime IS NULL`),
    index('idx_protocol_converters_protocol').on(table.clientProtocol, table.enabled),
    index('idx_protocol_converters_deleted_time').on(table.deletedTime),
  ],
)

export const logicalModels = sqliteTable(
  'logical_models',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    description: text('description').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /**
     * 逻辑模型在管理页的展示顺序，数值越小越靠前。
     * 全部历史数据与 `default` 都是 0，此时回退到 `createdTime` 排序，行为与加列前一致。
     */
    sortOrder: integer('sortOrder').notNull().default(0),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [index('idx_logical_models_enabled').on(table.enabled), index('idx_logical_models_deleted_time').on(table.deletedTime)],
)

export const workflows = sqliteTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    definition: text('definition').notNull(),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    uniqueIndex('idx_workflows_type_version').on(table.type, table.version),
    index('idx_workflows_type').on(table.type, table.deletedTime),
    index('idx_workflows_deleted_time').on(table.deletedTime),
  ],
)

export const schedulingPolicies = sqliteTable(
  'scheduling_policies',
  {
    logicalModelId: text('logicalModelId').notNull().references(() => logicalModels.id),
    providerModelId: text('providerModelId').notNull().references(() => providerModels.id),
    strategy: text('strategy').notNull().default('priority'),
    priority: integer('priority').notNull().default(0),
    weight: integer('weight').notNull().default(100),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    // 主键保留为「逻辑模型 + 供应商模型」：软删除的行会被重新加入时原地复活，
    // 因此不需要为它让位，也就不需要部分索引（主键本身无法条件化）。
    primaryKey({ columns: [table.logicalModelId, table.providerModelId] }),
    index('idx_scheduling_policies_route').on(table.logicalModelId, table.enabled, table.priority, table.weight),
    index('idx_scheduling_policies_deleted_time').on(table.deletedTime),
  ],
)

export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    /**
     * 客户端请求的协议。为 `null` 表示请求连 API 路径都无法识别，
     * 此时不存在「客户端协议」这个事实。
     */
    clientProtocol: text('clientProtocol'),
    /**
     * 客户端是否要求流式响应。请求体里即可确定，与上游实际是否流式返回无关
     * （后者是上游视角的事实，落在 `request_attempts.streaming`）。
     */
    streaming: integer('streaming', { mode: 'boolean' }).notNull().default(false),
    /**
     * 本次请求解析出的逻辑模型。为 `null` 表示请求在解析出逻辑模型之前
     * 就已经失败（模型非法 / 没有启用的逻辑模型），此时该请求不会产生任何
     * 上游尝试。
     */
    logicalModelId: text('logicalModelId'),
    /** 本次请求从开始到收尾的总耗时：请求级唯一的数值指标，因此直接作列。 */
    totalDurationMilliseconds: integer('totalDurationMilliseconds').notNull().default(0),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    index('idx_request_logs_created_time').on(table.createdTime),
    // 状态与时间必须同处一个索引：分析页的失败原因、请求列表的状态筛选都是
    // 「状态 + 时间窗」一起给，只有单列 status 索引时 SQLite 会先扫出全部同状态行
    // 再逐行过滤时间，代价与时间窗无关（等于全表）。
    index('idx_request_logs_status_created_time').on(table.status, table.createdTime),
    index('idx_request_logs_logical_model').on(table.logicalModelId),
    index('idx_request_logs_client_protocol').on(table.clientProtocol),
    check('chk_request_logs_status', sql`${table.status} in (${sql.raw(REQUEST_STATUS_VALUES)})`),
  ],
)

export const requestAttributes = sqliteTable(
  'request_attributes',
  {
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    key: text('key').notNull(),
    /** 属性值一律是字符串：采集侧只产出字符串，因此不另设「值类型」维度。 */
    value: text('value').notNull(),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    primaryKey({ columns: [table.requestId, table.key] }),
    index('idx_request_attributes_key_value').on(table.key, table.value),
    index('idx_request_attributes_created_time').on(table.createdTime),
  ],
)

/**
 * 请求级用量：每个请求、每种用量类型恰好一行。
 *
 * 只承载「请求级」这一个视角——列名因此为裸名，不存在 `attemptId` 这类
 * 可空判别列来切换行的含义。每次尝试的用量见 {@link attemptUsages}。
 *
 * 上游返回的原始 usage 报文也写在这张表里：它同样是「这个请求的用量记录」，
 * 只是不是数值。用 `type = 'raw'` 标记、由 `rawValue` 承载内容，归属键与数值行
 * 完全一致，不需要在请求行上另开一个可空列——一份事实只存一处。
 */
export const requestUsages = sqliteTable(
  'request_usages',
  {
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    type: text('type').notNull(),
    /**
     * 数值型用量的取值。`type = 'raw'` 的行为 `null`：原始报文不是数值，
     * 用 `0` 占位会直接污染 `sum(value)`。
     */
    value: real('value'),
    /** 原始 usage 报文（JSON 文本）。只有 `type = 'raw'` 的行有值。 */
    rawValue: text('rawValue'),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    primaryKey({ columns: [table.requestId, table.type] }),
    // 分析页按时间窗把用量拧成列时，先用这个索引把范围收窄到窗口内的行；
    // `type` 从不作为独立过滤条件出现（都是 `type = 'x'` 的透视，用不上前导列），
    // 所以这里不再保留 (type, createdTime) 索引。
    index('idx_request_usages_created_time').on(table.createdTime),
    check('chk_request_usages_type', sql`${table.type} in (${sql.raw(USAGE_TYPE_VALUES)})`),
    check('chk_request_usages_value_shape', sql`(${table.type} = 'raw' and ${table.value} is null and ${table.rawValue} is not null) or (${table.type} <> 'raw' and ${table.value} is not null and ${table.rawValue} is null)`),
  ],
)

/**
 * 尝试级用量：每次尝试、每种用量类型恰好一行。
 *
 * 归属关系由 `request_attempts.requestId` 唯一确定，因此这里不重复保存
 * `requestId`——同一个事实只能有一个来源。
 */
export const attemptUsages = sqliteTable(
  'attempt_usages',
  {
    attemptId: text('attemptId').notNull().references(() => requestAttempts.id),
    type: text('type').notNull(),
    /** 数值型用量的取值。`type = 'raw'` 的行为 `null`。 */
    value: real('value'),
    /** 上游返回的原始 usage 报文（JSON 文本）。只有 `type = 'raw'` 的行有值。 */
    rawValue: text('rawValue'),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    primaryKey({ columns: [table.attemptId, table.type] }),
    // 同 `request_usages`：只按时间窗收窄，`type` 只出现在透视表达式里。
    index('idx_attempt_usages_created_time').on(table.createdTime),
    check('chk_attempt_usages_type', sql`${table.type} in (${sql.raw(USAGE_TYPE_VALUES)})`),
    check('chk_attempt_usages_value_shape', sql`(${table.type} = 'raw' and ${table.value} is null and ${table.rawValue} is not null) or (${table.type} <> 'raw' and ${table.value} is not null and ${table.rawValue} is null)`),
  ],
)

export const requestAttempts = sqliteTable(
  'request_attempts',
  {
    id: text('id').primaryKey(),
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    providerId: text('providerId').notNull(),
    providerModelId: text('providerModelId').notNull(),
    providerName: text('providerName').notNull(),
    providerModelName: text('providerModelName').notNull(),
    /** 实际发往上游的协议。与 `request_logs.clientProtocol` 不同即代表发生过协议转换。 */
    upstreamProtocol: text('upstreamProtocol'),
    upstreamRequestId: text('upstreamRequestId'),
    url: text('url').notNull(),
    status: text('status').notNull(),
    httpStatus: integer('httpStatus'),
    retryable: integer('retryable', { mode: 'boolean' }).notNull().default(false),
    /**
     * 本次尝试上游是否以流式（SSE）返回。上游视角的事实，与客户端是否要求流式无关；
     * 未收到响应（网络错误、请求取消）时无从判断，因此为 `null`。
     */
    streaming: integer('streaming', { mode: 'boolean' }),
    attemptIndex: integer('attemptIndex').notNull(),
    durationMilliseconds: integer('durationMilliseconds').notNull(),
    /** 本次尝试从发出请求到上游首个输出的耗时；未产生输出时为 `null`。 */
    ttftMilliseconds: integer('ttftMilliseconds'),
    errorCode: text('errorCode'),
    errorMessage: text('errorMessage'),
    /** 该次尝试在请求阶段命中的改写规则 id（JSON 数组）。 */
    requestRewriteRuleIds: text('requestRewriteRuleIds').notNull().default('[]'),
    /** 该次尝试在响应阶段命中的改写规则 id（JSON 数组）。 */
    responseRewriteRuleIds: text('responseRewriteRuleIds').notNull().default('[]'),
    createdTime: integer('createdTime').notNull(),
  },
  table => [
    uniqueIndex('idx_request_attempts_request_order').on(table.requestId, table.attemptIndex),
    // 分析页的尝试级聚合全部只需要「一段时间内的尝试」，而请求时间窗的过滤条件
    // 落在 join 的另一张表上；没有这个索引时 SQLite 只能全表扫尝试，代价与时间窗无关。
    index('idx_request_attempts_created_time').on(table.createdTime),
    index('idx_request_attempts_provider_time').on(table.providerId, table.createdTime),
    index('idx_request_attempts_model_time').on(table.providerModelId, table.createdTime),
    check('chk_request_attempts_status', sql`${table.status} in (${sql.raw(ATTEMPT_STATUS_VALUES)})`),
  ],
)

/**
 * 客户端视角的正文记录：客户端原始请求 + 最终回给客户端的响应。
 * 每个请求恰好一行（`requestId` 唯一）。
 *
 * 列名不带 `client` 前缀——表本身就代表客户端视角。
 */
export const requestContents = sqliteTable(
  'request_contents',
  {
    id: text('id').primaryKey(),
    requestId: text('requestId').notNull().references(() => requestLogs.id),
    captureStatus: text('captureStatus').notNull(),
    requestMethod: text('requestMethod').notNull(),
    requestPath: text('requestPath').notNull(),
    requestHeaders: text('requestHeaders'),
    requestBody: text('requestBody'),
    /** 最终返回给客户端的 HTTP 状态码；为 `null` 表示客户端未收到任何响应。 */
    responseStatus: integer('responseStatus'),
    responseHeaders: text('responseHeaders'),
    responseBody: text('responseBody'),

    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    uniqueIndex('idx_request_contents_request').on(table.requestId),
    check('chk_request_contents_capture_status', sql`${table.captureStatus} in ('captured', 'partial')`),
  ],
)

/**
 * 上游视角的正文记录：真正发往上游的请求 + 上游返回的响应。
 * 每次尝试恰好一行（`attemptId` 唯一）。
 *
 * 列名不带 `upstream` 前缀——表本身就代表上游视角。归属的请求由
 * `request_attempts.requestId` 唯一确定，此处不重复保存。
 */
export const attemptContents = sqliteTable(
  'attempt_contents',
  {
    id: text('id').primaryKey(),
    attemptId: text('attemptId').notNull().references(() => requestAttempts.id),
    captureStatus: text('captureStatus').notNull(),
    requestHeaders: text('requestHeaders'),
    requestBody: text('requestBody'),
    responseStatus: integer('responseStatus'),
    responseHeaders: text('responseHeaders'),
    responseBody: text('responseBody'),

    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
  },
  table => [
    uniqueIndex('idx_attempt_contents_attempt').on(table.attemptId),
    check('chk_attempt_contents_capture_status', sql`${table.captureStatus} in ('captured', 'partial')`),
  ],
)

export const runtimeLogs = sqliteTable(
  'runtime_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    level: text('level').notNull(),
    message: text('message').notNull(),
    timestamp: integer('timestamp').notNull(),
  },
  table => [index('idx_runtime_logs_timestamp').on(table.timestamp), index('idx_runtime_logs_level_timestamp').on(table.level, table.timestamp)],
)

export type ProviderRow = typeof providers.$inferSelect
export type LogicalModelRow = typeof logicalModels.$inferSelect
export type ProviderModelRow = typeof providerModels.$inferSelect
export type ProviderHealthRow = typeof providerHealth.$inferSelect
export type ProviderModelHealthRow = typeof providerModelHealth.$inferSelect
export type SettingsRow = typeof settings.$inferSelect
export type ProviderSettingRow = typeof providerSettings.$inferSelect
export type ProviderEndpointRow = typeof providerEndpoints.$inferSelect
export type ProviderModelEndpointRow = typeof providerModelEndpoints.$inferSelect
export type ProtocolConverterRow = typeof protocolConverters.$inferSelect
export type SchedulingPolicyRow = typeof schedulingPolicies.$inferSelect
export type WorkflowRow = typeof workflows.$inferSelect
export type RuntimeLogRow = typeof runtimeLogs.$inferSelect
export type RequestLogRow = typeof requestLogs.$inferSelect
export type RequestAttributeRow = typeof requestAttributes.$inferSelect
export type RequestUsageRow = typeof requestUsages.$inferSelect
export type RequestAttemptRow = typeof requestAttempts.$inferSelect
export type RequestContentRow = typeof requestContents.$inferSelect
export type AttemptContentRow = typeof attemptContents.$inferSelect
export type AttemptUsageRow = typeof attemptUsages.$inferSelect
