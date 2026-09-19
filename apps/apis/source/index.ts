/**
 * 匿名使用统计的上报端点（Cloudflare Worker）。
 *
 * 它是**客户端与下游分析服务之间唯一的一层**，只干四件事（见 `docs/product/telemetry.md` §7）：
 *
 * 1. **严格校验**：用客户端同一份 schema 解析，拒绝多余字段；
 * 2. **白名单削平**：只把认识的字段交给下游；
 * 3. **补服务端字段**：地区来自 `request.cf.country`，时间戳来自服务器时钟；
 * 4. **限流**：按安装标识与来源 IP 哈希两个维度。
 *
 * 路径**只有 `/v1/track` 一条**（`TELEMETRY_REQUEST_PATH`），其余一律 404，根路径也不例外。
 * 刻意不为部署流水线另加一个健康检查接口：域名上「唯一一条路径」本身就是最强的信号，
 * 而流水线真正需要确认的只有「路由注册上了没有」——对 `GET /v1/track` 期待 405 就回答了它，
 * 那是一个只可能来自本 Worker 的答案（`.github/workflows/deploy-api.yml` 的 Smoke check 即此）。
 *
 * 为什么必须有这一层，而不是让客户端直接打 GA：GA 的密钥只应该存在于这里。桌面应用里嵌的
 * 任何凭证都能被解出来，所以「客户端不持有下游凭证」不是可选的组织方式，是唯一的正确形态。
 * 也因此这里**不做客户端鉴权**——它只能提供虚假的安全感（§7）。
 *
 * 端点地址是客户端里唯一写死的地址，**发布出去就是永久地址**：换下游、换存储、换数据驻留
 * 区域都只动这个 Worker。所以这里对客户端承诺的是**请求格式**（`/v1/track`），不是数据去向。
 */

import {
  TelemetryBatchSchema,
  TELEMETRY_REQUEST_PATH,
  type TelemetryEvent,
} from '@common/telemetry'
import { buildCollectBody, collectUrl } from './ga'
import { createRateLimiter } from './rate-limit'

/** 所有响应共用一个 Content-Type，只写一份。 */
const JSON_HEADERS = { 'Content-Type': 'application/json' }

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
  /** 设为 `1` 时要求 GA 反馈被忽略的参数。**只在排查埋点问题时开**，见 `ga.ts` 的说明。 */
  TELEMETRY_STRICT_VALIDATION?: string
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

export interface TelemetryHandlerOptions {
  /** 下游请求的实现。只在测试里替换；部署时不传，用运行时的 `fetch`。 */
  fetchImpl?: typeof fetch
}

/**
 * 造一个 handler。
 *
 * 之所以是工厂而不是一个模块级的函数：限流状态必须活在 handler 上，测试要能拿到互不干扰的
 * 实例。部署时用下面那个默认实例——**限流状态在部署形态下必须是长命的**，每次请求新建一个
 * 计数器等于没有限流。
 */
export function createTelemetryHandler(options: TelemetryHandlerOptions = {}): TelemetryHandler {
  const fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args))
  const addressLimiter = createRateLimiter(ADDRESS_LIMITS)
  const installLimiter = createRateLimiter(INSTALL_LIMITS)

  return async function handle(request, env, now = Date.now()) {
    const pathname = new URL(request.url).pathname

    // 只认一条路径。不在它上面的一律 404（根路径也是）：域名上**没有**「不知道为什么有回应」
    // 的地址，包括不给运维探针留位置——那件事由 `GET /v1/track` 的 405 回答，见文件头。
    if (pathname !== TELEMETRY_REQUEST_PATH) return json(404, { ok: false, error: 'not_found' })
    if (request.method !== 'POST') return methodNotAllowed('POST')
    if (!isJsonContentType(request.headers.get('content-type'))) return json(415, { ok: false, error: 'unsupported_media_type' })

    const credentials = credentialsOf(env)
    if (credentials === null) return json(500, { ok: false, error: 'not_configured' })
    const { measurementId, apiSecret } = credentials

    // 地址这一维度先于解析：它的判断不需要读正文，能在花掉反序列化的钱之前就把洪峰挡掉。
    const originKey = await originKeyOf(request)
    if (originKey !== null && !addressLimiter.admit(originKey, now)) return rateLimited()

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

    const events = parsed.data.events
    if (!installLimiter.admit(`id:${events[0].installId}`, now)) return rateLimited()
    if (!isSingleDevice(events)) return json(400, { ok: false, error: 'mixed_batch' })

    const body = buildCollectBody(events, {
      country: countryOf(request),
      receivedAt: now,
      strictValidation: env.TELEMETRY_STRICT_VALIDATION === '1',
    })

    const upstream = await postToGa(collectUrl(measurementId, apiSecret), body, fetchImpl)
    if (upstream === null) return json(502, { ok: false, error: 'upstream_unreachable' })
    // ⚠️ 2xx 只说明 GA 收下了请求，**不代表事件被接受**：参数超长、名字非法、时间戳过旧都会
    // 静默丢弃（telemetry.md §9）。所以这个返回值不能当验收标准用，验收要看实时报告。
    if (!upstream.ok) return json(502, { ok: false, error: 'upstream_rejected', status: upstream.status })
    return new Response(null, { status: 204 })
  }
}

/**
 * 同一批必须来自同一台设备。
 *
 * 不是洁癖：GA 的 `client_id`、`user_location`、`device` 都是**每请求一个**的字段，一批只能
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
 * Cloudflare 的附加请求属性。
 *
 * 只用得到 `cf.country` 一个字段，所以本地声明而不引 `@cloudflare/workers-types`：那套全局声明
 * 与 `lib.dom` 是两套互斥的 `Request` / `Response`，为这一个字段把整个仓库的类型环境改成
 * Workers 形态不值得。运行时它就在那里——`wrangler` 只打包不做类型检查。
 */
interface CloudflareRequest extends Request {
  cf?: { country?: string }
}

function countryOf(request: Request): string | null {
  const country = (request as CloudflareRequest).cf?.country
  return typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null
}

/**
 * 来源地址的限流键，**不透明且不落地**。
 *
 * 客户端不该在这里被识别，所以哈希只做一件事：把同一个地址在同一分钟内的请求归到同一个桶里。
 * 它不写日志、不出 Worker、isolate 一死就没了。因此这里不需要加盐——没有「谁都能读到的哈希
 * 表」可供反查。
 *
 * `CF-Connecting-IP` 由 Cloudflare 填，客户端伪造不了；**刻意不回退到 `X-Forwarded-For`**
 * （随便谁都能写），拿不到就跳过这一维度。跳过比共用一个假键好：万一这个头真的没了，
 * 共用假键会把「全体用户」塞进一个 120/分钟的桶里，那是一场自制的故障。
 */
async function originKeyOf(request: Request): Promise<string | null> {
  const address = request.headers.get('CF-Connecting-IP')
  if (address === null || address === '') return null
  return `ip:${await sha256Prefix(address)}`
}

async function sha256Prefix(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest).slice(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function postToGa(url: string, body: unknown, fetchImpl: typeof fetch): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MILLISECONDS)
  try {
    return await fetchImpl(url, {
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: allow },
  })
}

function rateLimited(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), {
    status: 429,
    headers: { ...JSON_HEADERS, 'Retry-After': '60' },
  })
}

// 部署形态的实例：无状态入口 + 长命的限流状态。
// 刻意**不加 CORS**：调用方是桌面应用与命令行，不是浏览器里的页面；放开跨域只会让它更容易被滥用。
export default { fetch: createTelemetryHandler() }
