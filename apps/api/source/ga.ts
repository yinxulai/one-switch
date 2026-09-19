/**
 * 「我们的事件」→「GA4 Measurement Protocol 请求体」。
 *
 * 这一层是**下游适配器**，是整条链路上唯一知道 GA 存在的地方（客户端只知道自己的域名与
 * 自己的事件名，见 `@common/telemetry` 的说明）。换后端要改的就是这个文件加一个兄弟文件。
 *
 * 纯函数、无 IO：报文进、请求体出。所以「哪个字段去了哪」可以逐条测，不必起服务器。
 */

import {
  TELEMETRY_COMMON_FIELD_NAMES,
  TELEMETRY_FIELD_TARGETS,
  TELEMETRY_MAX_BACKDATE_MILLISECONDS,
  TELEMETRY_UNKNOWN_COUNTRY,
  type TelemetryEvent,
} from '@common/telemetry'

/**
 * GA4 的收集端点。
 *
 * `measurement_id` 与 `api_secret` 只出现在这里：它们不进客户端二进制、不进设置、不进日志。
 * 向欧盟境内收集数据时把它换成 `region1.google-analytics.com`。
 */
export const GA_COLLECT_ORIGIN = 'https://www.google-analytics.com'

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

/** GA 里一个事件长什么样（只列我们用到的字段）。 */
export interface GaEvent {
  name: string
  params: Record<string, string>
  timestamp_micros?: number
}

/** GA 的请求体（只列我们用到的字段）。 */
export interface GaCollectBody {
  /** 用户标识。**用 `installId`**：自定义维度会被 GA 的基数上限折叠，`client_id` 不会。 */
  client_id: string
  user_location: { country_id: string }
  device: { operating_system: string; language: string }
  events: GaEvent[]
  /**
   * 只在排查埋点问题时出现。平时**不发**它：默认的 `RELAXED` 最大化接收率，
   * 而 `ENFORCE_RECOMMENDATIONS` 会让 GA 直接拒收它认为不合规的事件——那是调试手段，不是生产配置。
   */
  validation_behavior?: 'ENFORCE_RECOMMENDATIONS'
}

export interface BuildCollectBodyOptions {
  /** 服务端看到的地区（ISO 3166-1 alpha-2）；拿不到就传 `null`。 */
  country: string | null
  /** 服务端收到请求的时刻（毫秒）。时间戳回溯窗口以它为准。 */
  receivedAt: number
  /** 是否要求 GA 反馈被忽略的参数（仅排查时开启）。 */
  strictValidation?: boolean
}

/**
 * 把一批事件拼成一次 GA 请求。
 *
 * **一次批量 = 一次 GA 请求**，所以 `client_id`、`user_location`、`device` 这些「每请求一个」
 * 的字段只能取整批共有的值。调用方（`index.ts`）已经保证同一批的 `installId`、`os`、`locale`
 * 一致——它们本来就是同一台机器同一个进程发出来的，不一致说明有人手改了报文。
 */
export function buildCollectBody(events: readonly TelemetryEvent[], options: BuildCollectBodyOptions): GaCollectBody {
  const first = events[0]
  return {
    client_id: first.installId,
    user_location: { country_id: options.country ?? TELEMETRY_UNKNOWN_COUNTRY },
    device: {
      operating_system: GA_OPERATING_SYSTEM[first.os],
      language: first.locale,
    },
    events: events.map(event => toGaEvent(event, options.receivedAt)),
    ...(options.strictValidation === true ? { validation_behavior: 'ENFORCE_RECOMMENDATIONS' as const } : {}),
  }
}

function toGaEvent(event: TelemetryEvent, receivedAt: number): GaEvent {
  const timestamp = eventTimestamp(event.occurredAt, receivedAt)
  return {
    name: event.name,
    params: eventParams(event),
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
 * （`client_id` / 时间戳 / `device`），不进参数表。业务属性原样进。
 *
 * 扫描的是报文自身的键而不是一份硬编码名单：报文已被 `.strict()` 校验过，键集合只可能是
 * 契约里那些，所以「报文里有什么就发什么」在这里等价于白名单，而且契约加了字段这里自动跟上。
 */
function eventParams(event: TelemetryEvent): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(event)) {
    if (key === 'name') continue
    if (COMMON_FIELDS.has(key) && !isForwardedAsParam(key)) continue
    params[key] = String(value)
  }
  return params
}

function isForwardedAsParam(key: string): boolean {
  return TELEMETRY_FIELD_TARGETS[key as keyof typeof TELEMETRY_FIELD_TARGETS] === 'param'
}

/** GA 的收集地址（含凭证）。凭证来自 Worker 的 secret，不进仓库。 */
export function collectUrl(measurementId: string, apiSecret: string): string {
  const url = new URL('/mp/collect', GA_COLLECT_ORIGIN)
  url.searchParams.set('measurement_id', measurementId)
  url.searchParams.set('api_secret', apiSecret)
  return url.toString()
}
