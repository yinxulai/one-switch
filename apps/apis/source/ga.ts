/**
 * 「我们的事件」→「GA4 Measurement Protocol 请求体」。
 *
 * 这一层是**下游适配器**，是整条链路上唯一知道 GA 存在的地方（客户端只知道自己的域名与
 * 自己的事件名，见 `@common/telemetry` 的说明）。换后端要改的就是这个文件加一个兄弟文件。
 *
 * 纯函数、无 IO：报文进、请求体出。所以「哪个字段去了哪」可以逐条测，不必起服务器。
 *
 * 四个字段各有其位，靠的是 GA4 自己的机制而不是我们的命名：
 * - 安装标识 → `client_id`：它没有基数上限，而自定义维度有；
 * - 设备/语言 → `device`，用户在哪 → `ip_override`：原生报表直接读，不必先注册维度；
 * - 版本/架构 → `user_properties`：安装级事实，按用户保存才不会把一次升级算成两个用户；
 * - 业务属性 → 事件参数：就是事件自己的事。
 * 落点表在 `@common/telemetry` 的 `TELEMETRY_FIELD_TARGETS` 里，这里只负责执行它。
 *
 * 另外两个参数（`session_id` / `engagement_time_msec`）**不来自客户端**，是这一层按 GA 的
 * 要求补上的：它们不进契约，因为它们是「怎么把数据交给 GA」的事，不是「我们采集了什么」的事。
 */

import {
  type TelemetryEvent,
  TELEMETRY_FIELD_TARGETS,
  TELEMETRY_COMMON_FIELD_NAMES,
  TELEMETRY_MAX_BACKDATE_MILLISECONDS,
} from '@common/telemetry'

/**
 * GA4 的收集端点。
 *
 * `measurement_id` 与 `api_secret` 只出现在这里：它们不进客户端二进制、不进设置、不进日志。
 * 向欧盟境内收集数据时把它换成 `region1.google-analytics.com`。
 */
const GA_COLLECT_ORIGIN = 'https://www.google-analytics.com'

/** GA 用的是微秒，而 `occurredAt` 是毫秒。 */
const MICROSECONDS_PER_MILLISECOND = 1_000

/**
 * 我们的事件名直接当 GA 的事件名使用——它们是同一套约束下取的名字（见 telemetry.ts 的
 * 事件目录注释），不需要一张「我们的名字 → GA 的名字」的对照表。多一张表就多一处会漂移的东西。
 */

/**
 * `os` → GA 的 `device.operating_system`。
 *
 * 不用我们的 `win32` / `darwin` / `linux` 原样发：GA 侧对操作系统做**取值归一**，写进去的
 * 字符串要落在它的词表里，否则「平台构成」这一个视图读出来是空的。这里用的是 GA4 报表里
 * 「操作系统」维度的取值。
 *
 * ⚠️ 这一处映射要在真实上报后用 GA 的实时报告复核一次：它是全链路里唯一一处「我们猜 GA 的
 * 词表」的地方，猜错的后果是静默的空数据，不是报错。
 */
const GA_OPERATING_SYSTEM: Record<TelemetryEvent['os'], string> = {
  win32: 'Windows',
  darwin: 'Macintosh',
  linux: 'Linux',
}

/** 公共字段的集合。写成 Set 是为了在逐个字段扫描时用一次查表代替一次数组查找。 */
const COMMON_FIELDS: ReadonlySet<string> = new Set(TELEMETRY_COMMON_FIELD_NAMES)

/**
 * `device.category`：GA 只认 desktop / tablet / mobile / smart TV 四个取值。
 *
 * 两种宿主都发 `desktop`。命令行可能跑在无图形界面的服务器上，这是个已知的不精确——
 * 但四个取值里没有更接近的，而「图形界面还是命令行」这件事由 `runtime` 事件参数如实表达。
 * GA 的文档点名建议至少给出 `category`：不给的话「设备类别」这个原生维度是空的。
 */
const GA_DEVICE_CATEGORY = 'desktop'

/**
 * 广告同意状态：两处都声明「不要」。
 *
 * `consent` 是 GA4 同意模式里的字段，`non_personalized_ads` 是 Measurement Protocol 自己的
 * 布尔。我们做的是产品改进统计，两个都写死成拒绝——它也是 `telemetry.md` 里「不用作广告」
 * 这句承诺在代码上的落点。
 */
const GA_CONSENT = { ad_user_data: 'DENIED', ad_personalization: 'DENIED' } as const

/** 一天的毫秒数。只用来把「服务端收到时刻」折成自然日编号。 */
const MILLISECONDS_PER_DAY = 86_400_000

/**
 * 会话标识：**一次使用日 = 一个会话**。
 *
 * 这两个参数是 GA 归属「用户 / 会话 / 互动」三项指标的钥匙。官方参考文档写得很直白：
 * 不带的 `session_id` 与 `engagement_time_msec` 的事件「可能不会完全反映在实时用户数中」，
 * 而实时报告正是排查埋点时唯一的窗口（telemetry.md §10）。所以不是可选项。
 *
 * 桌面应用没有网页那种「一次浏览」，我们也不统计停留，所以这里不去猜一个会话的起止，
 * 而是取一个诚实的下界：**按服务端收到时刻算的自然日编号**。它是 `^\d+$` 的正整数，
 * 同一批必然同值，跨天自然翻新——于是「会话数」精确等于「有上报的安装·天」，
 * 正是我们能负责的那个量。用服务端时刻而不是客户端时刻：客户端改系统时间伪造不出会话。
 */
function sessionIdOf(receivedAt: number): number {
  return Math.floor(receivedAt / MILLISECONDS_PER_DAY)
}

/**
 * 互动时长：**一个固定的小值，不是测量结果**。
 *
 * 我们统计不了用户真的盯着界面看了多久（服务在后台跑，跟窗口有没有人看没关系），但给它一个
 * 非零值，GA 才会把这批事件算作「互动」。代价是「平均互动时长」失去意义——报表里不要读
 * 这一项（telemetry.md §11 已写明）。用一个常量而不是「事件间隔」之类的推算，是为了让这个
 * 假数字看起来就像个占位符，而不是被人当成真数据。
 */
const GA_ENGAGEMENT_TIME_MILLISECONDS = 1_000

/** GA 里一个用户属性：只有一个值，时间戳省了就按请求到达时间算。 */
export interface GaUserProperty {
  value: string
}

/** GA 里一个事件长什么样（只列我们用到的字段）。 */
export interface GaEvent {
  name: string
  /** 业务属性是字符串；`session_id` / `engagement_time_msec` 是数字——GA 对这两个是按数值解析的。 */
  params: Record<string, string | number>
  timestamp_micros?: number
}

/** GA 的请求体（只列我们用到的字段）。 */
export interface GaCollectBody {
  /** 用户标识。**用 `installId`**：自定义维度会被 GA 的基数上限折叠，`client_id` 不会。 */
  client_id: string
  /**
   * 安装级事实（`version` / `arch`），**每请求一份**。
   *
   * 代价要知道：GA 的用户属性在一个用户上只能有一个值，所以同一个安装升级后再上报，
   * 读到的是最后一次的值。因此「版本分布」是准的（一个安装只算一次），而「某个月的版本
   * 分布」是不准的——想按时段比较就得把它们放回事件参数。现在的取舍选了前者。
   */
  user_properties: Record<string, GaUserProperty>
  /**
   * 用户的 IP 地址，**由 GA 自己解析成地理位置**（城市 / 国家 / 大洲）。
   *
   * 这是请求里唯一与「用户在哪」有关的字段，而且**它必须存在**：转发请求是从 Cloudflare
   * 机房发出的，不给位置信息时 GA 会按请求的来源 IP（也就是机房出口）定位，于是全世界
   * 用户在报表里都同城。
   *
   * 交给 GA 而不是自己算，是因为我们手上本来就有**真实客户端 IP**（`CF-Connecting-IP`，
   * 见 `index.ts`），而 GA 的 IP 地理库比我们临时能拿到的任何东西都准：换 `user_location`
   * 就等于把一个更准的答案换成一个更粗的（`cf.country` 只有国家级），还要自己维护映射。
   *
   * ⚠️ `user_location` 与 `ip_override` **只能给一个**。GA 官方参考文档写明前者优先，
   * 同时发送时这个字段会被忽略——所以报文里**不能**出现 `user_location`，出现即等于没给位置。
   */
  ip_override?: string
  device: { category: string; operating_system: string; language: string }
  consent: { ad_user_data: 'DENIED'; ad_personalization: 'DENIED' }
  non_personalized_ads: true
  events: GaEvent[]
}

export interface BuildCollectBodyOptions {
  /** 服务端看到的**真实客户端 IP**（`CF-Connecting-IP`）；拿不到就传 `null`。 */
  ipOverride: string | null
  /** 服务端收到请求的时刻（毫秒）。时间戳回溯窗口以它为准。 */
  receivedAt: number
}

/**
 * 把一批事件拼成一次 GA 请求。
 *
 * **一次批量 = 一次 GA 请求**，所以 `client_id`、`user_properties`、`ip_override`、`device`、
 * `consent` 这些「每请求一个」的字段只能取整批共有的值，统一取首个事件的那份。调用方
 * （`index.ts`）已经保证同一批的 `installId`、`os`、`locale` 一致——它们本来就是同一台机器
 * 同一个进程发出来的，不一致说明有人手改了报文。
 */
export function buildCollectBody(events: readonly TelemetryEvent[], options: BuildCollectBodyOptions): GaCollectBody {
  const first = events[0]
  return {
    client_id: first.installId,
    user_properties: userPropertiesOf(first),
    // 地址拿不到就不带这个字段，而不是编一个：编出来的地址会让 GA 把用户定位到某个具体的地方，
    // 这比「不知道在哪」错得多（见 `index.ts` 文件头）。
    ...(options.ipOverride === null ? {} : { ip_override: options.ipOverride }),
    device: {
      category: GA_DEVICE_CATEGORY,
      operating_system: GA_OPERATING_SYSTEM[first.os],
      language: first.locale,
    },
    consent: GA_CONSENT,
    non_personalized_ads: true,
    events: events.map(event => toGaEvent(event, options.receivedAt)),
  }
}

function toGaEvent(event: TelemetryEvent, receivedAt: number): GaEvent {
  const timestamp = eventTimestamp(event.occurredAt, receivedAt)
  return {
    name: event.name,
    // 会话参数写在后面：万一将来某个业务属性重名，交给 GA 的必须是这两个（它们的类型还必须是数字）。
    params: {
      ...eventParams(event),
      session_id: sessionIdOf(receivedAt),
      engagement_time_msec: GA_ENGAGEMENT_TIME_MILLISECONDS,
    },
    ...(timestamp === null ? {} : { timestamp_micros: timestamp }),
  }
}

/**
 * 事件时间戳，**只在回溯窗口内才带上**。
 *
 * 超出窗口时返回 `null`（于是不带这个字段）而不是丢掉整个事件：GA 用接收时间补上，
 * 这条事件在「有」和「没有」之间选前者——补报本来就允许丢时间精度（telemetry.md §12），
 * 但「因为一次休眠恢复就整批数据没了」是另一回事。
 *
 * 未来的时间戳同样不带：那只会是客户端时钟错了，让 GA 用接收时间反而更接近事实。
 */
function eventTimestamp(occurredAt: number, receivedAt: number): number | null {
  const age = receivedAt - occurredAt
  if (age < 0 || age > TELEMETRY_MAX_BACKDATE_MILLISECONDS) return null
  return occurredAt * MICROSECONDS_PER_MILLISECOND
}

/**
 * 事件的参数：**白名单的落点**。
 *
 * 公共字段按 `TELEMETRY_FIELD_TARGETS` 分流——只有去 `param` 的进参数表，其余各有去向
 * （`client_id` / 时间戳 / `device` / `user_properties`），不进参数表。业务属性原样进。
 *
 * 扫描的是报文自身的键而不是一份硬编码名单：报文已被 `.strict()` 校验过，键集合只可能是
 * 契约里那些，所以「报文里有什么就发什么」在这里等价于白名单，而且契约加了字段这里自动跟上。
 */
function eventParams(event: TelemetryEvent): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(event)) {
    if (key === 'name') continue
    if (COMMON_FIELDS.has(key) && !targetOf(key, 'param')) continue
    params[key] = String(value)
  }
  return params
}

/**
 * 安装级的公共字段 → 用户属性。
 *
 * 只读首个事件：一批本就要求来自同一台设备，这几个字段必然相同。写成「取第一份」而不是
 * 「逐个合并」是为了让「一次请求只发一份用户属性」在代码上是显然的——GA 的模型就是每请求一份。
 */
function userPropertiesOf(event: TelemetryEvent): Record<string, GaUserProperty> {
  const properties: Record<string, GaUserProperty> = {}
  for (const field of TELEMETRY_COMMON_FIELD_NAMES) {
    if (!targetOf(field, 'userProperty')) continue
    properties[field] = { value: String(event[field]) }
  }
  return properties
}

/**
 * 查一个公共字段的落点。
 *
 * 两个方向各写一个 `is…` 函数会随着落点种类增加而各自膨胀，而且「支持哪些落点」这件事
 * 只该在一个地方表达：调用方把想要的落点传进来，比对就一次。
 */
function targetOf(field: string, target: string): boolean {
  return TELEMETRY_FIELD_TARGETS[field as keyof typeof TELEMETRY_FIELD_TARGETS] === target
}

/** GA 的收集地址（含凭证）。凭证来自 Worker 的 secret，不进仓库。 */
export function collectUrl(measurementId: string, apiSecret: string): string {
  const url = new URL('/mp/collect', GA_COLLECT_ORIGIN)
  url.searchParams.set('measurement_id', measurementId)
  url.searchParams.set('api_secret', apiSecret)
  return url.toString()
}
