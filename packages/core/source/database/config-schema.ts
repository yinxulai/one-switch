import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * 配置库（`osw-config-v1.db`）：**用户写的东西**。
 *
 * 供应商、模型、端点、协议转换、逻辑模型、路由策略、改写规则、工作流、全局设置——
 * 全部是用户在界面上敲出来的、丢了就得重敲一遍的内容。文件名的 schema 版本见
 * `@common/database-file`。
 *
 * 三条不变量，改动这个文件前先读完：
 *
 *   1. **不许 import `./data-schema`**，也不许反过来。两个库之间不存在外键、JOIN 与事务，
 *      这是「日志炸了配置也不受牵连」的全部依据。`packages/core/scripts/check-database-boundaries.mjs`
 *      会拒绝任何同时引到两边的**非白名单**文件。
 *   2. **不许在这里放「每次请求都要写」的东西。** 请求日志、用量、正文、运行时日志、
 *      健康状态（连续失败次数与冷却截止时间）全部属于数据库。健康状态是这套拆分里最容易
 *      放错的一处：它的主键看着像配置（供应商 id、供应商模型 id），但它在**每一个成功的
 *      请求**上都要写一次——留在配置库等于「每个请求都写配置库」，那就把这次拆分想解决的
 *      问题原样搬了回来。见 `docs/product/data-model.md` 的数据库拆分一节。
 *   3. 库内保留 `references()`：同一文件内的外键仍然由 SQLite 维护（连接时开
 *      `foreign_keys`）。跨库那两条已经删掉了，见数据库的说明。
 *
 * 只读操作（分析页、路由工作台的预览）会同时用到两个库，那是**读**的组合，
 * 由 `packages/core/source/database/index.ts` 给出的两个句柄在调用方拼，
 * 不在 schema 层提供任何「联合」。
 */

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
    /**
     * 供应商在管理页侧栏里的展示顺序，数值越小越靠前。
     * 全为 0（种子行与早期导入行）时回退到 `createdTime` 排序。
     */
    sortOrder: integer('sortOrder').notNull().default(0),
    createdTime: integer('createdTime').notNull(),
    updatedTime: integer('updatedTime').notNull(),
    deletedTime: integer('deletedTime'),
  },
  table => [
    index('idx_providers_enabled').on(table.enabled),
    index('idx_providers_deleted_time').on(table.deletedTime),
  ],
)

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
     * 全为 0（含 `default`）时回退到 `createdTime` 排序。
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
    description: text('description').notNull().default(''),
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

export type ProviderRow = typeof providers.$inferSelect
export type ProviderSettingRow = typeof providerSettings.$inferSelect
export type ProviderEndpointRow = typeof providerEndpoints.$inferSelect
export type ProviderModelRow = typeof providerModels.$inferSelect
export type ProviderModelEndpointRow = typeof providerModelEndpoints.$inferSelect
export type ProtocolConverterRow = typeof protocolConverters.$inferSelect
export type LogicalModelRow = typeof logicalModels.$inferSelect
export type SchedulingPolicyRow = typeof schedulingPolicies.$inferSelect
export type SettingsRow = typeof settings.$inferSelect
export type WorkflowRow = typeof workflows.$inferSelect
