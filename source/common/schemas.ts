import { z } from 'zod'

// ========== 枚举 ==========

export const ProtocolSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
])
export type Protocol = z.infer<typeof ProtocolSchema>

export const RuleStageSchema = z.enum(['request', 'response'])
export type RuleStage = z.infer<typeof RuleStageSchema>
export const RuleScopeSchema = z.enum(['global', 'model']).default('model')
export type RuleScope = z.infer<typeof RuleScopeSchema>

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(JsonValueSchema)]))
export const RequestRewriteRuleMatchSchema = z.object({
  clientProtocols: z.array(ProtocolSchema).max(3).default([]),
  upstreamProtocols: z.array(ProtocolSchema).max(3).default([]),
})
export type RequestRewriteRuleMatch = z.infer<typeof RequestRewriteRuleMatchSchema>
export const RequestRewriteRuleTestCaseSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  stage: RuleStageSchema.default('request'),
  body: z.string().max(2 * 1024 * 1024),
  headers: z.string().max(64 * 1024),
  clientProtocol: ProtocolSchema.default('openai-completions'),
  upstreamProtocol: ProtocolSchema.default('openai-completions'),
  streaming: z.boolean().default(false),
})
export type RequestRewriteRuleTestCase = z.infer<typeof RequestRewriteRuleTestCaseSchema>
const RequestRewriteRuleActionBaseSchema = z.object({ stage: RuleStageSchema.default('request') })
export const RequestRewriteRuleActionSchema = z.discriminatedUnion('type', [
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('header-set'), name: z.string().min(1).max(128), value: z.string().max(4096) }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('header-append'), name: z.string().min(1).max(128), value: z.string().max(4096) }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('header-remove'), name: z.string().min(1).max(128) }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('body-set'), path: z.string().min(3).max(512), value: JsonValueSchema }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('body-delete'), path: z.string().min(3).max(512) }),
  RequestRewriteRuleActionBaseSchema.extend({ type: z.literal('body-replace'), path: z.string().min(3).max(512), search: z.string().max(4096), replacement: z.string().max(4096), regex: z.boolean().default(false) }),
])
export type RequestRewriteRuleAction = z.infer<typeof RequestRewriteRuleActionSchema>
export const RequestRewriteRuleSchema = z.object({
  id: z.string().min(1), name: z.string().min(1).max(100), description: z.string().max(1000).default(''), enabled: z.boolean().default(true),
  scope: RuleScopeSchema, schemaVersion: z.number().int().positive().default(1), source: z.enum(['user', 'builtin', 'imported']).default('user'), match: RequestRewriteRuleMatchSchema.default({}),
  actions: z.array(RequestRewriteRuleActionSchema).min(1).max(50),
  testCases: z.array(RequestRewriteRuleTestCaseSchema).max(50).default([]),
  createdTime: z.number().int(), updatedTime: z.number().int(), deletedTime: z.number().int().nullable(),
})
export type RequestRewriteRule = z.infer<typeof RequestRewriteRuleSchema>
export const ProviderModelRequestRewriteRuleSchema = z.object({ providerModelId: z.string(), ruleId: z.string(), priority: z.number().int().nonnegative(), enabled: z.boolean().default(true), createdTime: z.number().int(), updatedTime: z.number().int(), deletedTime: z.number().int().nullable() })
export type ProviderModelRequestRewriteRule = z.infer<typeof ProviderModelRequestRewriteRuleSchema>

export const RequestStatusSchema = z.enum(['pending', 'success', 'failed', 'cancelled'])
export type RequestStatus = z.infer<typeof RequestStatusSchema>

// 尝试的状态里没有 `pending`：尝试行在拿到结果之后才写入，
// 「还没有结果」由「没有这一行」唯一表达，枚举里再留一个待定值就是留一条不可达状态。
export const AttemptStatusSchema = z.enum(['success', 'failed', 'cancelled'])
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>

// ========== Provider ==========

export const ProviderSchema = z.object({
  id: z.string().startsWith('prov_'),
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  description: z.string().default('').optional(),
  apiKeyReference: z.string(),
  timeoutMilliseconds: z.number().int().positive().default(30000),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type Provider = z.infer<typeof ProviderSchema>

export const ProviderSettingSchema = z.object({
  providerId: z.string().startsWith('prov_'),
  key: z.string().min(1),
  value: z.string(),
  valueType: z.enum(['string', 'number', 'boolean', 'json']).default('string'),
  updatedTime: z.number().int(),
})
export type ProviderSetting = z.infer<typeof ProviderSettingSchema>

export const ProviderEndpointSchema = z.object({
  id: z.string(),
  providerId: z.string().startsWith('prov_'),
  protocol: ProtocolSchema,
  url: z.string().url(),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type ProviderEndpoint = z.infer<typeof ProviderEndpointSchema>

export const ProviderModelSchema = z.object({
  id: z.string(),
  providerId: z.string().startsWith('prov_'),
  modelName: z.string().min(1),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type ProviderModel = z.infer<typeof ProviderModelSchema>

export const ProviderModelEndpointSchema = z.object({
  id: z.string(),
  providerModelId: z.string(),
  providerEndpointId: z.string(),
  url: z.string().url().nullable(),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type ProviderModelEndpoint = z.infer<typeof ProviderModelEndpointSchema>

export const ProtocolConverterSchema = z.object({
  id: z.string(),
  providerModelEndpointId: z.string(),
  clientProtocol: ProtocolSchema,
  enabled: z.boolean().default(false),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type ProtocolConverter = z.infer<typeof ProtocolConverterSchema>

export const SchedulingPolicySchema = z.object({
  logicalModelId: z.string(),
  providerModelId: z.string(),
  strategy: z.string().min(1).default('priority'),
  priority: z.number().int(),
  weight: z.number().int().positive(),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type SchedulingPolicy = z.infer<typeof SchedulingPolicySchema>

// ========== Logical Model ==========

/** Logical model IDs are stable public queue identifiers. */
export const LogicalModelIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, '队列 ID 必须以小写字母开头，只能包含小写字母、数字、下划线和连字符（最多 64 个字符）')

export const LogicalModelSchema = z.object({
  id: LogicalModelIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type LogicalModel = z.infer<typeof LogicalModelSchema>

// ========== Provider Model ==========

/** Protocol endpoint configuration for a provider model route. */
export const ProtocolEndpointSchema = z.object({
  protocol: ProtocolSchema,
  endpointUrl: z.string().default(''),
  customAuthHeader: z.string().nullable().default(null),
  protocolConversionEnabled: z.boolean().default(false),
})
export type ProviderModelRouteEndpoint = z.infer<typeof ProtocolEndpointSchema>

export const ProviderModelRouteSchema = z.object({
  id: z.string(),
  providerId: z.string().startsWith('prov_'),
  modelName: z.string().min(1),
  endpoints: z.array(ProtocolEndpointSchema).default([]),
  priority: z.number().int(),
  enabled: z.boolean().default(true),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
  deletedTime: z.number().int().nullable(),
})
export type ProviderModelRoute = z.infer<typeof ProviderModelRouteSchema>

// ========== Provider Health ==========

export const ProviderHealthSchema = z.object({
  providerId: z.string().startsWith('prov_'),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  cooldownUntilTime: z.number().int().nullable(),
  lastSuccessTime: z.number().int().nullable(),
  lastFailureTime: z.number().int().nullable(),
  updatedTime: z.number().int(),
})
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>

export const ProviderModelHealthSchema = ProviderHealthSchema.omit({ providerId: true }).extend({ providerModelId: z.string() })
export type ProviderModelHealth = z.infer<typeof ProviderModelHealthSchema>

export const HealthSnapshotSchema = z.object({
  providers: z.array(ProviderHealthSchema),
  providerModels: z.array(ProviderModelHealthSchema),
})
export type HealthSnapshot = z.infer<typeof HealthSnapshotSchema>

// ========== Settings ==========

export const OutboundProxyModeSchema = z.enum(['direct', 'system', 'custom'])
export type OutboundProxyMode = z.infer<typeof OutboundProxyModeSchema>

export const SettingsSchema = z.object({
  id: z.literal('singleton'),
  listenHost: z.string().default('127.0.0.1'),
  listenPort: z.number().int().min(1).max(65535).default(9300),
  logRetentionDays: z.number().int().positive().default(30),
  captureRequestContent: z.boolean().default(true),
  cooldownBaseSeconds: z.number().int().positive().default(30),
  cooldownMaxSeconds: z.number().int().positive().default(300),
  consecutiveFailureThreshold: z.number().int().positive().default(3),
  idleTimeoutMilliseconds: z.number().int().positive().default(30000),
  outboundProxyMode: OutboundProxyModeSchema.default('system'),
  outboundProxyUrl: z.string().default(''),
  outboundProxyBypass: z.string().default('localhost,127.0.0.1,::1'),
  autoLaunch: z.boolean().default(false),
  updatedTime: z.number().int(),
})
export type Settings = z.infer<typeof SettingsSchema>

// ========== Request Log ==========

export const RawUsageSchema = z.record(z.unknown())
export type RawUsage = z.infer<typeof RawUsageSchema>

export const RequestLogSchema = z.object({
  id: z.string().startsWith('req_'),
  /** 为 `null` 表示请求在解析出逻辑模型之前就已经失败。 */
  logicalModelId: z.string().nullable(),
  /** 为 `null` 表示请求连 API 路径都无法识别，不存在「客户端协议」这个事实。 */
  clientProtocol: ProtocolSchema.nullable(),
  /** 客户端是否要求流式响应。请求体里即可确定，与上游实际是否流式无关。 */
  streaming: z.boolean(),
  status: RequestStatusSchema,
  totalDurationMilliseconds: z.number().int().nonnegative(),
  /**
   * 用量字段都是**派生视图**，不是存储列。
   *
   * 请求级用量（含原始 usage 报文）由 `request_usages` 唯一持有，原始报文是其中
   * `type = 'raw'` 的行；`totalTokens` 则是 `inputTokens + outputTokens` 的派生值，
   * 不单独落库，避免出现「上游给了 total 但和两个分量对不上」的第三份数字。
   */
  totalTokens: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable().optional(),
  cacheCreationInputTokens: z.number().int().nonnegative().nullable(),
  /** 派生值：请求级 `cachedInputTokens > 0`。缓存是否命中不是独立事实。 */
  promptCacheHit: z.boolean().nullable(),
  rawUsage: RawUsageSchema.nullable(),
  /** 请求级派生值：由本次请求所有 `request_attempts.ttftMilliseconds` 取最小值得出，不是存储列。 */
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  createdTime: z.number().int(),
})
export type RequestLog = z.infer<typeof RequestLogSchema>
/**
 * 请求日志的可更新字段。
 *
 * 只剩「请求级结果」这一类事实：状态与总耗时。以下字段刻意不可写：
 * `ttftMilliseconds` 是尝试级事实的视图；用量（含原始 usage 报文）由
 * `request_usages` 唯一持有，写入点是「服务该请求的那次尝试」的落库事务。
 * 允许在这里再写一遍，就是制造一份会与尝试级数据漂移的副本。
 */
export type RequestLogUpdate = Partial<Pick<RequestLog, 'status' | 'totalDurationMilliseconds'>>

export const RequestAttributeSchema = z.object({
  requestId: z.string().startsWith('req_'),
  key: z.string().min(1).max(128),
  /** 属性值一律是字符串：采集侧只产出字符串，因此不另设「值类型」维度。 */
  value: z.string().max(4096),
  createdTime: z.number().int(),
})
export type RequestAttribute = z.infer<typeof RequestAttributeSchema>

// ========== Request Attempt ==========

export const RequestAttemptSchema = z.object({
  id: z.string().startsWith('att_'),
  requestId: z.string().startsWith('req_'),
  providerId: z.string().startsWith('prov_'),
  providerModelId: z.string(),
  providerName: z.string(),
  providerModelName: z.string(),
  /** 实际发往上游的协议。与请求的 `clientProtocol` 不同即代表发生过协议转换。 */
  upstreamProtocol: ProtocolSchema.nullable(),
  upstreamRequestId: z.string().nullable(),
  url: z.string(),
  attemptIndex: z.number().int().nonnegative(),
  status: AttemptStatusSchema,
  httpStatus: z.number().int().nullable(),
  retryable: z.boolean(),
  /**
   * 本次尝试上游是否以流式（SSE）返回。
   *
   * 这是**上游视角**的事实。「客户端是否要求流式」是请求级事实，落在
   * `request_logs.streaming`，两者是不同的东西，不能互相顶替。
   * 未收到响应（网络错误、请求取消）时无从判断，因此为 `null`。
   */
  streaming: z.boolean().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMilliseconds: z.number().int().nonnegative(),
  /** 本次尝试从发出请求到上游首个输出的耗时；未产生输出时为 null。 */
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  /** 该次尝试在请求阶段命中的改写规则 id。 */
  requestRewriteRuleIds: z.array(z.string()).default([]),
  /** 该次尝试在响应阶段命中的改写规则 id。 */
  responseRewriteRuleIds: z.array(z.string()).default([]),
  createdTime: z.number().int(),
})
export type RequestAttempt = z.infer<typeof RequestAttemptSchema>

// 正文采集的状态。只有「采到了」和「只采到一部分」两种真实情况：
// 采集被设置关闭时根本不会写入正文行，因此“没有行 = 未采集”由行是否
// 存在唯一确定，不需要用枚举值再表达一次。
// captured — 完整采集
// partial  — 只采集到部分内容（流式中断、上游报错、请求未走完）
export const RequestContentCaptureStatusSchema = z.enum(['captured', 'partial'])
export type RequestContentCaptureStatus = z.infer<typeof RequestContentCaptureStatusSchema>

// 正文模型按「视角」正交拆分，每张表只承载一个视角，因此列名一律使用裸名
// （headers / body / status）而不再带 client / upstream 前缀——视角由表名
// 唯一确定，不存在二义。
//
//   request_contents   客户端视角（每个请求一行）
//   attempt_contents   上游视角  （每次尝试一行）
//
// 「发生过协议转换」这个事实不单独建表：它由
// `request_attempts.upstreamProtocol` 与请求的 `clientProtocol` 是否相同
// 唯一确定，单独存一份必然会漂移。
// 是否流式则按视角拆成两个事实：客户端是否要求流式落在 `request_logs.streaming`，
// 上游是否以流式返回落在 `request_attempts.streaming`。

/**
 * 客户端视角的正文记录：客户端原始请求 + 最终回给客户端的响应。
 * 每个请求恰好一行（`requestId` 唯一）。
 */
export const RequestContentSchema = z.object({
  id: z.string().startsWith('content_'),
  requestId: z.string().startsWith('req_'),
  captureStatus: RequestContentCaptureStatusSchema,
  /** 客户端使用的 HTTP 方法。 */
  requestMethod: z.string(),
  /** 客户端请求的路径。 */
  requestPath: z.string(),
  /** 客户端原始请求头（脱敏后的 JSON 字符串）。 */
  requestHeaders: z.string().nullable(),
  /** 客户端原始请求体。 */
  requestBody: z.string().nullable(),
  /** 最终返回给客户端的 HTTP 状态码。 */
  responseStatus: z.number().int().nullable(),
  /** 最终返回给客户端的响应头（脱敏后的 JSON 字符串）。 */
  responseHeaders: z.string().nullable(),
  /** 最终返回给客户端的响应体。 */
  responseBody: z.string().nullable(),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type RequestContent = z.infer<typeof RequestContentSchema>

/**
 * 上游视角的正文记录：真正发往上游的请求 + 上游返回的响应。
 * 每次尝试恰好一行（`attemptId` 唯一）。
 *
 * 归属的请求、命中的改写规则这些事实都由 `request_attempts` 持有，
 * 这里只保存上游视角的报文本身。
 */
export const AttemptContentSchema = z.object({
  id: z.string().startsWith('attempt_content_'),
  attemptId: z.string().startsWith('att_'),
  captureStatus: RequestContentCaptureStatusSchema,
  /** 发往上游的请求头（脱敏后的 JSON 字符串），含改写与协议转换的结果。 */
  requestHeaders: z.string().nullable(),
  /** 发往上游的请求体，含改写与协议转换的结果。 */
  requestBody: z.string().nullable(),
  /** 上游返回的 HTTP 状态码。 */
  responseStatus: z.number().int().nullable(),
  /** 上游返回的响应头（脱敏后的 JSON 字符串）。 */
  responseHeaders: z.string().nullable(),
  /** 上游返回的响应体。 */
  responseBody: z.string().nullable(),
  createdTime: z.number().int(),
  updatedTime: z.number().int(),
})
export type AttemptContent = z.infer<typeof AttemptContentSchema>

// ========== API 响应结构 ==========

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  errorCode: z.string(),
  errorMessage: z.string(),
})

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.union([ApiSuccessSchema(dataSchema), ApiErrorSchema])

export type ApiSuccess<T> = { success: true; data: T }
export type ApiError = { success: false; errorCode: string; errorMessage: string }
export type ApiResponse<T> = ApiSuccess<T> | ApiError

// ========== API 错误码（统一枚举） ==========

export const ApiErrorCodeSchema = z.enum([
  // 通用
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'HTTP_ERROR',
  // 认证
  'UNAUTHORIZED',
  'FORBIDDEN',
  // 资源
  'RESOURCE_NOT_FOUND',
  'DUPLICATE_RESOURCE',
  // 代理
  'UNKNOWN_API_PATH',
  'UPSTREAM_ERROR',
  'ALL_PROVIDERS_FAILED',
  'PROXY_NOT_RUNNING',
  'NO_MODEL_CONFIGURED',
  'PROXY_INTERNAL_ERROR',
  'SYSTEM_PROXY_RESOLUTION_FAILED',
  'OUTBOUND_PROXY_UNREACHABLE',
  'OUTBOUND_PROXY_AUTH_REQUIRED',
  'OUTBOUND_PROXY_TUNNEL_REJECTED',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'CLIENT_REQUEST_ABORTED',
])
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>

// ========== 请求日志条目（含 attempt + providerName，用于列表展示） ==========

export const RequestLogEntryAttemptSchema = z.object({
  id: z.string().startsWith('att_'),
  attemptIndex: z.number().int().nonnegative(),
  status: AttemptStatusSchema,
  providerId: z.string(),
  providerName: z.string(),
  providerModelId: z.string(),
  providerModelName: z.string(),
  upstreamProtocol: ProtocolSchema.nullable(),
  upstreamRequestId: z.string().nullable(),
  url: z.string(),
  httpStatus: z.number().int().nullable(),
  retryable: z.boolean(),
  /** 本次尝试上游是否以流式（SSE）返回；未收到响应时为 `null`。 */
  streaming: z.boolean().nullable(),
  /** 本次尝试从发出请求到上游首个输出的耗时；未产生输出时为 null。 */
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  /** 该次尝试在请求阶段命中的改写规则 id。 */
  requestRewriteRuleIds: z.array(z.string()),
  /** 该次尝试在响应阶段命中的改写规则 id。 */
  responseRewriteRuleIds: z.array(z.string()),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMilliseconds: z.number().int().nonnegative(),
  createdTime: z.number().int(),
})
export type RequestLogEntryAttempt = z.infer<typeof RequestLogEntryAttemptSchema>

export const RequestLogEntrySchema = z.object({
  id: z.string().startsWith('req_'),
  /** 为 `null` 表示请求在解析出逻辑模型之前就已经失败。 */
  logicalModelId: z.string().nullable(),
  /** 为 `null` 表示请求连 API 路径都无法识别。 */
  clientProtocol: ProtocolSchema.nullable(),
  /** 客户端是否要求流式响应。 */
  streaming: z.boolean(),
  status: RequestStatusSchema,
  totalDurationMilliseconds: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  cacheCreationInputTokens: z.number().int().nonnegative().nullable(),
  promptCacheHit: z.boolean().nullable(),
  rawUsage: RawUsageSchema.nullable(),
  ttftMilliseconds: z.number().int().nonnegative().nullable(),
  createdTime: z.number().int(),
  attempts: z.array(RequestLogEntryAttemptSchema),
})
export type RequestLogEntry = z.infer<typeof RequestLogEntrySchema>

export const AppliedRequestRewriteRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
})
export type AppliedRequestRewriteRule = z.infer<typeof AppliedRequestRewriteRuleSchema>

export const RequestLogDetailSchema = RequestLogEntrySchema.extend({
  contents: z.array(RequestContentSchema),
  attemptContents: z.array(AttemptContentSchema),
  requestRewriteRules: z.array(AppliedRequestRewriteRuleSchema),
})
export type RequestLogDetail = z.infer<typeof RequestLogDetailSchema>

// ========== 运行日志条目 ==========

export const LogEntrySchema = z.object({
  id: z.number().int().positive(),
  level: z.enum(['log', 'warn', 'error', 'info', 'debug']),
  message: z.string(),
  timestamp: z.number().int(),
})
export type LogEntry = z.infer<typeof LogEntrySchema>

// ========== 代理服务状态 ==========

export const ProxyServerStatusSchema = z.object({
  running: z.boolean(),
  host: z.string(),
  port: z.number().int(),
})
export type ProxyServerStatus = z.infer<typeof ProxyServerStatusSchema>

// ========== 统计分析 ==========

export const AnalyticsRangeSchema = z.enum(['today', '7d', '30d'])
export type AnalyticsRange = z.infer<typeof AnalyticsRangeSchema>

export const StatsSummarySchema = z.object({
  totalRequests: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})
export type StatsSummary = z.infer<typeof StatsSummarySchema>

export const DailyTrendPointSchema = z.object({
  label: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
})
export type DailyTrendPoint = z.infer<typeof DailyTrendPointSchema>

export const ProviderStatSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  /** 调用次数（每次上游尝试计一次，与请求数不同）。 */
  attempts: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
  percent: z.number().int().min(0).max(100),
})
export type ProviderStat = z.infer<typeof ProviderStatSchema>

export const ModelStatSchema = z.object({
  providerModelId: z.string(),
  providerModelName: z.string(),
  providerId: z.string(),
  providerName: z.string(),
  /** 调用次数（每次上游尝试计一次，与请求数不同）。 */
  attempts: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
  avgTtftMs: z.number().nonnegative().nullable(),
  avgTps: z.number().nonnegative().nullable(),
  cacheHitRate: z.number().min(0).max(1).nullable(),
})
export type ModelStat = z.infer<typeof ModelStatSchema>

export const LatencyBucketSchema = z.object({
  range: z.string(),
  count: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
})
export type LatencyBucket = z.infer<typeof LatencyBucketSchema>

export const FailureReasonStatSchema = z.object({
  reason: z.string(),
  count: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
})
export type FailureReasonStat = z.infer<typeof FailureReasonStatSchema>

export const RequestSourceStatSchema = z.object({
  source: z.string(),
  category: z.string(),
  requests: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  avgLatencyMs: z.number().nonnegative(),
})
export type RequestSourceStat = z.infer<typeof RequestSourceStatSchema>

export const ProviderRequestTrendPointSchema = z.object({
  label: z.string(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
})
export type ProviderRequestTrendPoint = z.infer<typeof ProviderRequestTrendPointSchema>

export const ProviderDetailSummarySchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  /** 调用次数（每次上游尝试计一次，与请求数不同）。 */
  attempts: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})
export type ProviderDetailSummary = z.infer<typeof ProviderDetailSummarySchema>

export const ProviderAnalyticsDetailSchema = z.object({
  summary: ProviderDetailSummarySchema,
  requestTrend: z.array(ProviderRequestTrendPointSchema),
  tokenTrend: z.array(DailyTrendPointSchema),
  models: z.array(ModelStatSchema),
  latencyDistribution: z.array(LatencyBucketSchema),
  failureReasons: z.array(FailureReasonStatSchema),
})
export type ProviderAnalyticsDetail = z.infer<typeof ProviderAnalyticsDetailSchema>

export const AnalyticsSummarySchema = z.object({
  summary: StatsSummarySchema,
  trend: z.array(DailyTrendPointSchema),
  providerStats: z.array(ProviderStatSchema),
  modelStats: z.array(ModelStatSchema),
  latencyDistribution: z.array(LatencyBucketSchema),
  failureReasons: z.array(FailureReasonStatSchema),
  sourceStats: z.array(RequestSourceStatSchema),
})
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>
