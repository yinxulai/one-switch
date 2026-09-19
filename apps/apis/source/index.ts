/**
 * 匿名使用统计的上报端点（Cloudflare Worker）。
 *
 * 它是**客户端与下游分析服务之间唯一的一层**，只干四件事（见 `docs/product/telemetry.md` §7）：
 *
 * 1. **严格校验**：用客户端同一份 schema 解析，拒绝多余字段；
 * 2. **白名单削平**：只把认识的字段交给下游；
 * 3. **补服务端字段**：把真实客户端 IP 交给 GA 去解析地理位置，时间戳来自服务器时钟；
 * 4. **限流**：按安装标识与来源地址两个维度。
 *
 * 请求路径只有 `/v1/track` 一条（`TELEMETRY_REQUEST_PATH`），其余一律 404，根路径也不例外。
 * 刻意不为部署流水线另加一个健康检查接口：域名上「唯一一条路径」本身就是最强的信号，
 * 而部署后真正要确认的只有「路由注册上了没有」——对 `GET /v1/track` 期待 405 就回答了它，
 * 那是一个只可能来自本 Worker 的答案。
 *
 * 为什么必须有这一层，而不是让客户端直接打 GA：GA 的密钥只应该存在于这里。桌面应用里嵌的
 * 任何凭证都能被解出来，所以「客户端不持有下游凭证」不是可选的组织方式，是唯一的正确形态。
 * 也因此这里**不做客户端鉴权**——它只能提供虚假的安全感（§7）。
 *
 * 端点地址是客户端里唯一写死的地址，**发布出去就是永久地址**：换下游、换存储、换数据驻留
 * 区域都只动这个 Worker。所以这里对客户端承诺的是**请求格式**（`/v1/track`），不是数据去向。
 *
 * ## 关于来源 IP
 *
 * 转发请求是从 **Cloudflare 机房**发出的，而 GA 在没有拿到显式地理位置时会按请求的来源 IP
 * （也就是机房出口）定位——结果是「所有用户都落在数据中心所在地」。所以这里全程用的是
 * **客户端的真实 IP**，而不是这个 Worker 自己的出口：
 *
 * - **地理**：`CF-Connecting-IP`（Cloudflare 填的真实客户端 IP，客户端伪造不了）作为
 *   `ip_override` 交给 GA，由 GA 自己解析成地理位置。**这是故意的**：IP 地理库在 GA 那边，
 *   比我们临时读一个 `cf.country`（只有国家级）准得多，也不必自己维护映射表。
 *   代价说清楚：**用户的 IP 会随这次转发进入 GA**——报文的其余部分仍然是白名单字段。
 * - **限流**：同一个地址哈希后当键，不落地、不出 Worker（除上面那次转发外）。
 *
 * ⚠️ `user_location` 与 `ip_override` **只能给一个**：GA 文档写明前者优先，两者同时出现时
 * `ip_override` 会被忽略。所以报文里**没有** `user_location`，给了它这个 IP 就白传了。
 *
 * 两处都取不到就各自降级（不传 `ip_override`、地址维度直接跳过），**绝不退回请求自身的来源地址**：
 * 那只会得到一个「所有人都来自机房」的假键。
 */

import {
  TelemetryBatchSchema,
  TELEMETRY_REQUEST_PATH,
  type TelemetryEvent,
} from '@common/telemetry'
import { buildCollectBody, collectUrl } from './ga'
import { createRateLimiter } from './rate-limit'

/**
 * Worker 的绑定。
 *
 * `GA_MEASUREMENT_ID` 与 `GA_API_SECRET` 是 secret（`wrangler secret put`），不进仓库、不进
 * `wrangler.toml`、不进客户端。
 */
export interface TelemetryEnv {
  GA_MEASUREMENT_ID?: string
  /** Measurement Protocol 的 API 密钥。它一旦泄露，任何人都能往这个媒体资源里灌数据。 */
  GA_API_SECRET?: string
}

/**
 * 请求体上限：64 KiB。
 *
 * 一批 25 条事件的实际体积在 4 KiB 量级，所以这个上限离正常用量很远，只用来让「往端点灌大包」
 * 变成一件便宜的事。GA 自己的上限是 130 kB，比这里宽，所以这里卡住的同时也就顺便守住了它。
 */
const MAX_REQUEST_BODY_BYTES = 64 * 1024

/**
 * 转发给下游的请求超时（毫秒）。
 *
 * **必须短于客户端的超时**（`TELEMETRY_REQUEST_TIMEOUT_MILLISECONDS`，5 秒）：否则客户端会先
 * 放弃，而我们已经把请求发了出去——那是「客户端以为失败了、下游其实收到了」的最坏情形，
 * 虽然统计能容忍重复与丢失，但没有理由主动制造它。
 */
const UPSTREAM_TIMEOUT_MILLISECONDS = 3_000

/** 每个来源地址每分钟的请求数上限。 */
const ADDRESS_LIMITS = { windowMilliseconds: 60_000, maxPerWindow: 120, maxKeys: 20_000 }

/**
 * 每个安装标识每分钟的请求数上限。
 *
 * 客户端默认每 30 秒最多发一批（`TELEMETRY_FLUSH_INTERVAL_MILLISECONDS`），所以正常用量在
 * 每分钟 2 次量级；30 这个数字留出了「补报积压一次性发完」与「同机多实例」的余量，
 * 却仍然能挡住循环发送。
 */
const INSTALL_LIMITS = { windowMilliseconds: 60_000, maxPerWindow: 30, maxKeys: 50_000 }

export type TelemetryHandler = (request: Request, env: TelemetryEnv, now?: number) => Promise<Response>

/** 下游请求的实现。写成别名是为了让「可以在测试里换掉」这件事在签名上一眼可见。 */
type Fetcher = typeof fetch

/**
 * 造一个 handler。
 *
 * 之所以是工厂而不是一个模块级的函数：限流状态必须活在 handler 上，测试要能拿到互不干扰的
 * 实例。部署时用文件末尾那个默认实例——**限流状态在部署形态下必须是长命的**，每次请求新建
 * 一个计数器等于没有限流。
 */
export function createTelemetryHandler(fetcher: Fetcher = fetch): TelemetryHandler {
  const addressLimiter = createRateLimiter(ADDRESS_LIMITS)
  const installLimiter = createRateLimiter(INSTALL_LIMITS)

  return async function handle(request, env, now = Date.now()) {
    // ---- 1. 路由：只有一条路径，只有一种方法 ----

    // 只认一条路径。不在它上面的一律 404（根路径也是）：域名上**没有**「不知道为什么有回应」
    // 的地址，包括不给运维探针留位置——那件事由 `GET /v1/track` 的 405 回答，见文件头。
    if (new URL(request.url).pathname !== TELEMETRY_REQUEST_PATH) return json(404, { ok: false, error: 'not_found' })
    if (request.method !== 'POST') return methodNotAllowed('POST')
    if (!isJsonContentType(request.headers.get('content-type'))) return json(415, { ok: false, error: 'unsupported_media_type' })

    // ---- 2. 下游配置：缺了就说清楚，不能静默丢数据 ----

    const credentials = credentialsOf(env)
    if (credentials === null) return json(500, { ok: false, error: 'not_configured' })
    const { measurementId, apiSecret } = credentials

    // ---- 3. 来源地址限流 ----

    // 地址这一维度先于解析：它的判断不需要读正文，能在花掉反序列化的钱之前就把洪峰挡掉。
    // 键来自 `CF-Connecting-IP`，即**真实客户端 IP**；同一个地址还要作为 `ip_override`
    // 交给 GA（见第 6 步），所以这个头只读一次。拿不到就跳过这一维度（见文件头）。
    const address = addressOf(request)
    if (address !== null && !addressLimiter.admit(`ip:${await sha256Prefix(address)}`, now)) return rateLimited()

    // ---- 4. 严格校验 ----

    const text = await request.text()
    if (byteLength(text) > MAX_REQUEST_BODY_BYTES) return json(413, { ok: false, error: 'payload_too_large' })

    const payload = parseJson(text)
    if (payload === null) return json(400, { ok: false, error: 'invalid_json' })

    const parsed = TelemetryBatchSchema.safeParse(payload)
    if (!parsed.success) {
      // 回显前几条问题：客户端开发者要能自己看出报文哪里不对，而这里没有任何秘密可泄露
      // （schema 是开源的、端点本来也没有鉴权）。
      return json(400, {
        ok: false,
        error: 'invalid_payload',
        issues: parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      })
    }

    // ---- 5. 安装标识限流 + 一批只能来自一台设备 ----

    const events = parsed.data.events
    if (!installLimiter.admit(`id:${events[0].installId}`, now)) return rateLimited()
    if (!isSingleDevice(events)) return json(400, { ok: false, error: 'mixed_batch' })

    // ---- 6. 削平 + 补服务端字段 + 转发 ----

    const body = buildCollectBody(events, { ipOverride: address, receivedAt: now })

    const upstream = await postToGa(collectUrl(measurementId, apiSecret), body, fetcher)
    if (upstream === null) {
      // 唯一的日志点，而且只说「下游答不答」，不说「谁在发」：没有安装标识、没有来源地址、
      // 没有报文正文。`wrangler.toml` 把 `[observability]` 打开，等的就是这行。
      console.error('[apis] upstream unreachable')
      return json(502, { ok: false, error: 'upstream_unreachable' })
    }
    // ⚠️ 2xx 只说明 GA 收下了请求，**不代表事件被接受**：参数超长、名字非法、时间戳过旧都会
    // 静默丢弃（telemetry.md §9）。所以这个返回值不能当验收标准用，验收要看实时报告。
    if (!upstream.ok) {
      console.error(`[apis] upstream rejected status=${upstream.status}`)
      return json(502, { ok: false, error: 'upstream_rejected', status: upstream.status })
    }
    return new Response(null, { status: 204 })
  }
}

/**
 * 同一批必须来自同一台设备。
 *
 * 不是洁癖：GA 的 `client_id`、`ip_override`、`device` 都是**每请求一个**的字段，一批只能
 * 表达一个值。混着发就必然要把某些事件归到别的用户或别的平台上去——那比拒收更糟，
 * 因为它静默地坏了口径。
 */
function isSingleDevice(events: readonly TelemetryEvent[]): boolean {
  const [first] = events
  return events.every(event =>
    event.installId === first.installId
    && event.os === first.os
    && event.locale === first.locale)
}

/**
 * 请求的来源地址，**真实客户端 IP**。
 *
 * `CF-Connecting-IP` 由 Cloudflare 填，客户端伪造不了；**刻意不回退到 `X-Forwarded-For`**
 * （随便谁都能写）。拿不到就返回 `null`：限流跳过这一维度，地理位置也不传——**绝不退回
 * 请求自身的来源地址**，那只会得到「所有用户都来自机房」的假答案（见文件头）。
 *
 * 这里做一次形状检查：这个值会被写进转发报文，而报文是给外部服务的。真正的保证来自
 * Cloudflare 会覆盖这个头，这里只是不让一个畸形的值穿过去。
 */
function addressOf(request: Request): string | null {
  const address = request.headers.get('CF-Connecting-IP')
  if (address === null) return null
  const trimmed = address.trim()
  // 45 字符是 IPv6 长度上限；字符集同时容纳 IPv4 与 IPv6 的写法。
  return trimmed !== '' && trimmed.length <= 45 && /^[0-9a-fA-F.:]+$/.test(trimmed) ? trimmed : null
}

/**
 * 地址哈希，**只用作限流键**。
 *
 * 客户端不该在这里被识别，所以哈希只做一件事：把同一个地址在同一分钟内的请求归到同一个桶里。
 * 它不写日志、isolate 一死就没了，所以这里不需要加盐——没有「谁都能读到的哈希表」可供反查。
 *
 * 取前 8 字节而不是全长：这个键只活在内存表的生命周期里，碰撞概率要远低于「一台机器在
 * 一分钟内换 IP」的可能，而短键让表更便宜。
 */
async function sha256Prefix(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest).slice(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function postToGa(url: string, body: unknown, fetcher: Fetcher): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MILLISECONDS)
  try {
    return await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType !== null && contentType.toLowerCase().startsWith('application/json')
}

interface DownstreamCredentials {
  measurementId: string
  apiSecret: string
}

/**
 * 「下游配置齐了吗」只留这一个定义：业务路径据此回 500。写成两份判断，迟早会出现
 * 「这条路径说配好了、那条路径说没配」这种最难查的不一致。
 */
function credentialsOf(env: TelemetryEnv): DownstreamCredentials | null {
  const { GA_MEASUREMENT_ID: measurementId, GA_API_SECRET: apiSecret } = env
  if (!isNonEmpty(measurementId) || !isNonEmpty(apiSecret)) return null
  return { measurementId, apiSecret }
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== ''
}

/**
 * 所有响应的头都只从这里出去。
 *
 * 刻意**不加 CORS**：调用方是桌面应用与命令行，不是浏览器里的页面，放开跨域只会让它更容易被
 * 滥用。刻意**不设 `Cache-Control`**：这里没有任何东西值得被缓存，而缓存住一个 429 是真伤害。
 */
function responseHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json; charset=utf-8', ...extra }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders() })
}

function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
    status: 405,
    headers: responseHeaders({ Allow: allow }),
  })
}

function rateLimited(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), {
    status: 429,
    headers: responseHeaders({ 'Retry-After': '60' }),
  })
}

// 部署形态：入口无状态，限流状态活在模块作用域上，所以它比 isolate 活得短、比请求活得多。
const handleRequest = createTelemetryHandler()

/**
 * Worker 的入口。
 *
 * 单独写成一个有名的函数而不是直接内联进 `export default`：入口是部署之后最先要去的一行，
 * 它应该能被搜到、能被打断点。运行时还会传第三个参数 `ExecutionContext`，这里用不到，
 * 不声明即可。
 */
export function workerFetch(request: Request, env: TelemetryEnv): Promise<Response> {
  return handleRequest(request, env)
}

export default { fetch: workerFetch }
