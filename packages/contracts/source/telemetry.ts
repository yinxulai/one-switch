/**
 * 匿名使用统计的报文契约（默认关闭，见 `docs/product/telemetry.md`）。
 *
 * 这个文件是**客户端与 Worker 共用的唯一一份定义**：事件名的闭集、公共字段、属性枚举、
 * 长度与批次上限、端点常量都在这里。文档（telemetry.md §5）与两端代码引用的是同一份东西，
 * 所以「文档写了一个事件、代码里没有」这种事只在文档失修时才会发生，而不是在实现时。
 *
 * 三条不能随手改的性质：
 *
 * 1. **事件名与属性名是闭集，只增不删。** 删掉一个名字等于历史数据里那一列失去解释。
 *    要停用就在文档里标「已停用」并停止发送，不是从这张表里移除。
 * 2. **这里不出现任何自由文本字段。** 所有属性都是固定枚举（唯一例外是把事件名本身当
 *    参数名用的那些，见下），所以没有任何位置能塞进一个 URL、一个供应商名或一段用户内容。
 * 3. **约束要在这里卡死，不能指望下游报错。** GA4 对超长、非法或超出枚举的参数**不报错**，
 *    只是丢掉（telemetry.md §9），所以「长度对不对」是这里的类型问题，不是运行期问题。
 *
 * 本文件不 import 任何 Node 内置模块：它是契约，Worker 跑在 V8 isolate 里（见
 * `packages/toolkit/scripts/check-package-boundaries.mjs`）。
 */

import { z } from 'zod'
import { HOST_RUNTIMES } from './runtime-config'
import { WORKFLOW_NODE_KINDS } from './router/types'
import { ProtocolSchema, RouteModeSchema } from './schemas'

// ========== 端点 ==========

/**
 * 上报端点。**客户端里写死的唯一一个地址。**
 *
 * 这是「已经发出去的客户端里的地址改不了了」那句话的落点（telemetry.md §6）：
 * 换分析后端、换存储、换数据驻留区域、整站迁移，都只动 Worker，客户端一行都不用改。
 * 所以它的改动门槛比看上去高得多，上线前就该当作永久前缀来选。
 *
 * 必须是自有域名，**不能是 `workers.dev` 子域**：后者绑在平台命名空间上，改名即作废。
 */
export const TELEMETRY_ENDPOINT = 'https://api.osw.yinxulai.com/v1/track'

/**
 * 路径里的 `v1` 是**请求格式**的版本，不是数据去向的版本。
 *
 * 端点不变意味着会有很旧的客户端一直打过来，所以兼容窗口是「永久」而不是「支持几个版本」：
 * 新增字段一律可选，破坏性变更开新路径并**长期保留旧解析**（telemetry.md §7）。
 *
 * 末段叫 `track` 而不是 `events`：这条路径是整个域名上唯一的一条，名字应当直接说出
 * 「这里是收埋点的地方」，而不是依赖上下文才知道 `events` 是谁的事件。
 */
export const TELEMETRY_REQUEST_PATH = '/v1/track'

// ========== 硬上限 ==========

/**
 * 单批事件数上限，25。
 *
 * 这是 GA4 Measurement Protocol 的硬限制（一次请求最多 25 个事件），**超出了不报错、直接丢**。
 * 因此它必须由客户端守住，而不是由 Worker 截断：截断会静默改变统计口径。
 * Worker 收到超长批次的做法是**拒绝**，不是切到 25 条。
 */
export const TELEMETRY_MAX_EVENTS_PER_BATCH = 25

/** 事件名与属性名的长度上限（GA4 的上限）。 */
export const TELEMETRY_MAX_NAME_LENGTH = 40

/** 属性值的长度上限（标准版 GA4；360 版是 500）。 */
export const TELEMETRY_MAX_ATTRIBUTE_VALUE_LENGTH = 100

/**
 * **用户属性**值的长度上限，36。
 *
 * 与事件参数值（100）是两个不同的上限：GA4 对 `user_properties` 单独卡 36 字符
 * （名字卡 24）。超长的用户属性 GA **不报错、直接丢**，所以凡是落点在那里的字段
 * 都得按这个数字卡住（telemetry.md §9）。
 */
export const TELEMETRY_MAX_USER_PROPERTY_VALUE_LENGTH = 36

/** 单个事件的属性数上限（GA4 的上限）。 */
export const TELEMETRY_MAX_ATTRIBUTES_PER_EVENT = 25

/**
 * 时间戳可回溯的窗口，72 小时。
 *
 * GA4 拒绝更早的 `timestamp_micros`；`RELAXED` 模式下它不会拒收事件，而是把时间戳替换成
 * 72 小时前。因此 Worker 的做法是：超出窗口时**丢掉 `occurredAt` 而不是丢掉事件**
 * （telemetry.md §7）。
 */
export const TELEMETRY_MAX_BACKDATE_MILLISECONDS = 72 * 60 * 60 * 1000

/** 上报请求的超时（毫秒级，不参与任何重试预算）。 */
export const TELEMETRY_REQUEST_TIMEOUT_MILLISECONDS = 5_000

/**
 * 默认批量条数。
 *
 * 远小于 25 的硬上限：批量只为了少发几次请求，不是为了攒到极限。真正决定它的是
 * 「一次上报不能明显拖慢关闭流程」（telemetry.md §12）。
 */
export const TELEMETRY_DEFAULT_BATCH_SIZE = 12

/** 凑不满一批时的最长等待（毫秒）；先到先发。 */
export const TELEMETRY_FLUSH_INTERVAL_MILLISECONDS = 30_000

// ========== 公共字段 ==========

/**
 * 每条事件都带的字段，由客户端填写。**它们与具体的业务属性分开定义**，因为写事件的人
 * 只该关心自己那几个属性，公共字段由上报器统一补（见 `TelemetryEventInput`）。
 */
export const TelemetryCommonFieldsSchema = z.object({
  /** 事件发生时间，本地时钟的毫秒时间戳。 */
  occurredAt: z.number().int().nonnegative(),
  /**
   * 本机匿名安装标识，标准 UUID v4。
   *
   * 直接上报本地 UUID，**不派生、不轮换**：worker 拿它当 GA4 的 `client_id` 用，
   * 因此 GA 的 `users` 指标就是它的去重计数，跨天的活跃与留存全部现成可用。
   * 轮换换不到真正的匿名，却会把 GA 的留存报表全部废掉（telemetry.md §4）。
   *
   * 客户端**不知道**它在下游被当 `client_id` 用，这是 Worker 的事。
   */
  installId: z.string().uuid(),
  /**
   * 应用版本，由宿主注入（core 拿不到渲染层的版本常量，也没有 electron）。
   *
   * 长度按**用户属性**的上限卡（36），不是按事件参数的上限（40）：它在下游的落点是
   * `user_properties.version`，多出来的字符会被 GA 直接丢掉。
   */
  version: z.string().min(1).max(TELEMETRY_MAX_USER_PROPERTY_VALUE_LENGTH),
  /** 操作系统。 */
  os: z.enum(['win32', 'darwin', 'linux']),
  /** CPU 架构。 */
  arch: z.enum(['x64', 'arm64', 'ia32']),
  /** 用户实际选择的界面语言，不是系统语言。 */
  locale: z.enum(['en', 'zh-CN']),
  /** 宿主形态。枚举来自运行时配置，不在这里另抄一份。 */
  runtime: z.enum(HOST_RUNTIMES),
})

export type TelemetryCommonFields = z.infer<typeof TelemetryCommonFieldsSchema>

/** 公共字段名，供「组装事件」的地方一次性剔除。 */
export const TELEMETRY_COMMON_FIELD_NAMES = [
  'occurredAt',
  'installId',
  'version',
  'os',
  'arch',
  'locale',
  'runtime',
] as const

// ========== 事件目录（首版，只增不删） ==========

/** `service_start_failed.reason`：启动失败的归因分桶。 */
export const TELEMETRY_SERVICE_FAILURE_REASONS = ['instance_lock', 'port', 'database', 'other'] as const

/** 供产出失败归因的地方直接引用，不必写 `Extract<...>`。 */
export type TelemetryServiceFailureReason = (typeof TELEMETRY_SERVICE_FAILURE_REASONS)[number]

/**
 * `failover_happened.attempts`：**分桶，不发精确次数**。
 *
 * 精确值对产品决策没有额外信息量，却是更细的行为指纹。
 */
export const TELEMETRY_FAILOVER_ATTEMPT_BUCKETS = ['2', '3', '4+'] as const

/** `rewrite_rule_created.kind`：规则来源。 */
export const TELEMETRY_REWRITE_RULE_KINDS = ['builtin', 'custom'] as const

/** 布尔属性统一发字符串，不走 JSON 布尔：GA 的参数值以字符串为准。 */
const TelemetryBooleanSchema = z.enum(['true', 'false'])

/** 布尔属性的类型别名。 */
export type TelemetryBoolean = z.infer<typeof TelemetryBooleanSchema>

/**
 * 事件名的闭集。
 *
 * 每一项是一句话能说清的产品事实，不是一次函数调用。判断标准见 telemetry.md §5.3：
 * 事件目录就是**需求边界**，表里没有的问题首版不加字段，先在文档里加一行再说。
 *
 * GA4 的预留名（`error`、`session_start`、`first_visit`、`app_install`、`app_update`、
 * `user_engagement` 等）不能用；属性名也不得以 `_`、`firebase_`、`ga_`、`google_`、`gtag.`
 * 开头。新增事件时要再查一次——这些约束 GA 不会在发送时报错。
 */
export const TelemetryEventSchema = z.discriminatedUnion('name', [
  /** 服务启动完成。 */
  z.object({ ...TelemetryCommonFieldsSchema.shape, name: z.literal('app_started') }).strict(),
  /** 启动最终失败。`reason` 是归因分桶，不带错误原文——那是排障信息，不是统计。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('service_start_failed'),
    reason: z.enum(TELEMETRY_SERVICE_FAILURE_REASONS),
  }).strict(),
  /** 用户改变统计开关。关闭时尽力发一次，否则只能看到「某天起不再出现」，区分不出关闭/卸载/断网。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('telemetry_toggled'),
    enabled: TelemetryBooleanSchema,
  }).strict(),
  /** 引导走完或跳过。`skipped` 为真表示没走完就退出——它与「走完了」是两种不同的结果。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('onboarding_finished'),
    skipped: TelemetryBooleanSchema,
  }).strict(),
  /** 生效模式切换。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('route_mode_changed'),
    mode: RouteModeSchema,
  }).strict(),
  /** 新建 Provider。只发来源，不发名称与地址。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('provider_created'),
    kind: z.enum(['builtin', 'custom']),
  }).strict(),
  /** 添加 ProviderModel。协议是产品能力维度，不是供应商标识。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('model_added'),
    protocol: ProtocolSchema,
  }).strict(),
  /** 连接测试。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('provider_test_run'),
    result: z.enum(['success', 'failed']),
  }).strict(),
  /** 新建请求改写规则。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('rewrite_rule_created'),
    kind: z.enum(TELEMETRY_REWRITE_RULE_KINDS),
  }).strict(),
  /** 一次请求发生了协议转换；两侧都记，否则「转换从哪来到哪去」这一格读不出来。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('protocol_conversion_used'),
    from: ProtocolSchema,
    to: ProtocolSchema,
  }).strict(),
  /** 一次请求发生了故障转移。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('failover_happened'),
    attempts: z.enum(TELEMETRY_FAILOVER_ATTEMPT_BUCKETS),
  }).strict(),
  /**
   * 工作流节点执行。`nodeKind` 的取值**就是** `@common/router/types` 的 `WORKFLOW_NODE_KINDS`，
   * 不在这里再抄一份枚举：节点类型是路由领域的词，它变了这里跟着变才对。
   *
   * 这一格必须是枚举而不是字符串。契约的红线是「不存在任何自由文本字段」（telemetry.md §3），
   * 而 40 个字符足够塞进一段 URL；节点类型清单收缩时老客户端会在这层被拒，那正是
   * 「破坏性变更开新路径」这条既有约定的适用场景（§7）。
   */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('workflow_node_run'),
    nodeKind: z.enum(WORKFLOW_NODE_KINDS),
  }).strict(),
  /** 导出日志。只发「带没带正文」，不发导了多少条、导到了哪。 */
  z.object({
    ...TelemetryCommonFieldsSchema.shape,
    name: z.literal('logs_exported'),
    withContent: TelemetryBooleanSchema,
  }).strict(),
])

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>
export type TelemetryEventName = TelemetryEvent['name']

/** 全部事件名。与 schema 同源，不是另抄一份名单。 */
export const TELEMETRY_EVENT_NAMES = TelemetryEventSchema.options
  .map(option => option.shape.name.value) as TelemetryEventName[]

/**
 * 写事件的人要提供的东西：只有事件名与它自己的属性。
 *
 * 公共字段（版本、平台、标识、时间）由上报器统一补，写业务的人碰不到它们——
 * 少一个可以填错的地方。`DistributiveOmit` 是必要的：直接用 `Omit` 会把联合类型
 * 压成一个共有的属性集，判别联合的窄化就没了。
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type TelemetryEventInput = DistributiveOmit<TelemetryEvent, (typeof TELEMETRY_COMMON_FIELD_NAMES)[number]>

/** `.omit` 要的是 `{ key: true }`，不是名字数组；写在这里能让它跟着公共字段名单一起变。 */
const OMIT_COMMON_FIELDS = {
  occurredAt: true,
  installId: true,
  version: true,
  os: true,
  arch: true,
  locale: true,
  runtime: true,
} as const satisfies Record<(typeof TELEMETRY_COMMON_FIELD_NAMES)[number], true>

/**
 * `TelemetryEventInput` 的运行期对应物：与事件联合**同源**，只是不含公共字段。
 *
 * 存在的理由是边界。界面侧发生的事（走完引导、新建 Provider）要经管理接口交给 core 上报，
 * 那条接口收的是不可信输入，必须有校验；而校验的对象偏偏是「去掉公共字段之后」的形状。
 * 派生而不是另抄一份，是为了让「新增一个事件」只改上面那一处。
 *
 * 两个写法上的让步，都只是类型系统的形状问题，不影响运行期：
 * - 回调参数标注成宽的 `ZodObject<ZodRawShape>`：`options` 的元素是十三项联合，
 *   直接 `.omit` 会因为「联合的签名互不兼容」而不通过（联合不整体可调用）；
 * - 前两项单独拆出来再展开剩余项：`z.union` 的签名要求「首个元素 + 第二项 + 其余」，
 *   而 `.map` 的返回值在类型上是数组，直接展开满足不了那个元组形状。
 */
const EVENT_INPUT_OPTIONS = TelemetryEventSchema.options.map((option: z.ZodObject<z.ZodRawShape>) =>
  option.omit(OMIT_COMMON_FIELDS),
)
const [firstEventInputSchema, secondEventInputSchema, ...restEventInputSchemas] = EVENT_INPUT_OPTIONS
/**
 * 不导出：写入侧的校验入口是下面的解析器。多一个导出就多一个可以绕过断言、
 * 直接拿到退化输出类型的口子，而契约层的价值正在于「只有一个说法」。
 */
const TelemetryEventInputSchema = z.union([
  firstEventInputSchema,
  secondEventInputSchema,
  ...restEventInputSchemas,
])

/**
 * 校验一份「写入方视角」的事件；不是合法的事件就返回 `null`。
 *
 * 里面那处断言是**类型系统的补丁，不是运行期的放宽**：`.omit(Omit<ZodRawShape, …>)` 推算出来的
 * 输出类型会退化成 `{ [x: string]: any }`（因为 Omit 掉几个键之后 shape 只剩索引签名），
 * 而校验通过的值在运行期确实是 `TelemetryEventInput`——它就是同一份联合去掉公共字段。
 * 断言写在这里而不是调用点，是为了让「为什么可以断言」和 schema 待在同一屏。
 */
export function parseTelemetryEventInput(value: unknown): TelemetryEventInput | null {
  const result = TelemetryEventInputSchema.safeParse(value)
  return result.success ? (result.data as TelemetryEventInput) : null
}

// ========== 请求体 ==========

/** 上报请求体。 */
export const TelemetryBatchSchema = z.object({
  events: z.array(TelemetryEventSchema).min(1).max(TELEMETRY_MAX_EVENTS_PER_BATCH),
}).strict()

export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>

// ========== 公共字段在下游的去向 ==========

/**
 * 每个公共字段去哪，写在这里而不是写在 Worker 的 `switch` 里。
 *
 * 四个不进事件参数的去向各有理由：
 * - `installId` → `client_id`：GA4 的自定义维度每天每维度约 500 个不同值后会把余下的折进
 *   `(other)`，安装标识这种量级第一天就会被折叠；而 `client_id` 没有这个上限；
 * - `occurredAt` → 时间戳：GA 用的是事件自己的时间，不是一个叫 `occurredAt` 的参数；
 * - `os` / `locale` → `device`：它们本就是设备属性，GA 的原生报表直接读这两个字段，
 *   走参数反而要额外注册自定义维度；
 * - `version` / `arch` → `user_properties`：它们是**安装级**事实而不是事件级事实。走用户属性
 *   之后 GA 按用户保存，「版本分布」这一类问题里同一个安装只算一次（升级不会同时出现在两行），
 *   而且不占用每个事件 25 个参数的名额。
 *
 * `runtime` **刻意留在事件参数里**：桌面端与命令行共用数据目录、因而共用安装标识，
 * 同一个安装会先后发出两种 `runtime`。做成用户属性只会让它按最后一次上报来回翻。
 */
export const TELEMETRY_FIELD_TARGETS = {
  occurredAt: 'timestamp',
  installId: 'clientId',
  os: 'deviceOperatingSystem',
  locale: 'deviceLanguage',
  version: 'userProperty',
  arch: 'userProperty',
  runtime: 'param',
} as const satisfies Record<(typeof TELEMETRY_COMMON_FIELD_NAMES)[number], string>

/**
 * 需要**事先注册**才能查的用户级自定义维度：`version` 与 `arch`（telemetry.md §11）。
 *
 * 留在这里是为了让「要注册哪几个维度」有个代码里的落点——顺序很关键：维度必须在
 * **首次上报之前**注册，否则注册前的数据在这些维度上永远是空的，且无法回填。
 */
export const TELEMETRY_USER_PROPERTIES = ['version', 'arch'] as const

// ========== 预览 ==========

/**
 * 「预览即将发送的内容」的响应（telemetry.md §13 要求设置页能自证）。
 *
 * `events` 必须是**真实报文**，不是另写一份说明文案：
 * - 队列里有待发送的事件时，给的就是那一批（`source: 'queue'`）；
 * - 队列为空时（绝大多数时候都是），用当前公共字段造一条 `app_started`（`source: 'sample'`），
 *   界面据此标注来源。两种来源走的是同一个序列化路径，所以用户看到的字节与真正会发出去的
 *   字节是同一份东西。
 */
export interface TelemetryPreview {
  /** 设置里的开关值。 */
  enabled: boolean
  /**
   * 是否真的在跑。
   *
   * 与 `enabled` 分开的原因：开关开着但没上报有好几种可能（开发档、标识文件写不动、
   * 补丁版本不认识当前平台），那些都不该在界面上表现成「已开启」。
   */
  running: boolean
  /** 实际使用的端点：正式构建下是常量，开发档可能被 `telemetryEndpoint` 覆盖。 */
  endpoint: string
  /** 本机安装标识；不可用时为 `null`。它也是「拿这个去删我的数据」的凭据。 */
  installId: string | null
  events: TelemetryEvent[]
  source: 'queue' | 'sample'
}
