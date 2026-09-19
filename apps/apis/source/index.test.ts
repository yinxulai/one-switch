import { describe, expect, it, vi } from 'vitest'
import type { TelemetryEvent } from '@common/telemetry'
import entry, { createTelemetryHandler, workerFetch, type TelemetryEnv } from './index'

const NOW = 1_700_000_000_000
const INSTALL_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const ENDPOINT = 'https://api.osw.yinxulai.com/v1/track'
const ENV: TelemetryEnv = { GA_MEASUREMENT_ID: 'G-TEST123', GA_API_SECRET: 'secret' }

interface CapturedRequest {
  url: string
  body: unknown
  method: string | undefined
}

/** 下游替身。返回给定状态码，并把收到的请求留下来给断言用。 */
function createUpstream(status = 204): { fetcher: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    return new Response(null, { status })
  }) as typeof fetch
  return { fetcher, calls }
}

type EventOverrides = Partial<Pick<Extract<TelemetryEvent, { name: 'app_started' }>, 'installId' | 'os' | 'locale' | 'occurredAt'>>

function appStarted(overrides: EventOverrides = {}): TelemetryEvent {
  return {
    name: 'app_started',
    occurredAt: NOW - 1_000,
    installId: INSTALL_ID,
    version: '1.1.0-beta.14',
    os: 'win32',
    arch: 'x64',
    locale: 'en',
    runtime: 'desktop',
    ...overrides,
  }
}

interface PostOptions {
  events?: readonly TelemetryEvent[]
  country?: string | null
  body?: string
  contentType?: string | null
  method?: string
  url?: string
  address?: string | null
}

function post(options: PostOptions = {}): Request {
  const headers: Record<string, string> = {}
  if (options.contentType !== null) headers['content-type'] = options.contentType ?? 'application/json'
  if (options.address !== null) headers['cf-connecting-ip'] = options.address ?? '203.0.113.7'
  const method = options.method ?? 'POST'
  // GET / HEAD 不允许带正文，而这里多数用例只关心状态码，所以只在这两个方法下省掉 body。
  const body = method === 'POST' ? options.body ?? JSON.stringify({ events: options.events ?? [appStarted()] }) : undefined
  const request = new Request(options.url ?? ENDPOINT, { method, headers, body })
  if (options.country) {
    ;(request as unknown as { cf: { country: string } }).cf = { country: options.country }
  }
  return request
}

describe('上报端点', () => {
  describe('路由与请求头', () => {
    it('根路径也是 404——域名上不留「不知道为什么有回应」的地址', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(
        post({ url: 'https://api.osw.yinxulai.com/', method: 'GET', contentType: null }),
        ENV,
        NOW,
      )

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
    })

    // 端点只有一条，所以「近亲路径」也必须被拒：多一个斜杠、多一段、换一个名字都算别的地址。
    // `/v1/events` 是这条路径的**旧名字**，单独立一条回归用例：改名之后它必须一直是 404，
    // 否则会把「老客户端还在打旧地址」误报成「请求成功了」。
    it.each(['/v1/events', '/v1/track/', '/v1/track/extra'])(
      '%s 不是端点，与其他未知路径一样 404',
      async path => {
        const handler = createTelemetryHandler(createUpstream().fetcher)

        const response = await handler(
          post({ url: `https://api.osw.yinxulai.com${path}`, method: 'GET', contentType: null }),
          ENV,
          NOW,
        )

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
      },
    )

    it('GET /v1/track 只允许 POST', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(post({ method: 'GET' }), ENV, NOW)

      // 这个 405 同时也是部署后的探针：它只可能来自本 Worker，所以「路由注册上了没有」
      // 靠它就能回答，不必为此再单独开一个接口。
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
    })

    it('非 JSON 的 Content-Type 拒绝', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(post({ contentType: 'text/plain' }), ENV, NOW)

      expect(response.status).toBe(415)
    })

    it('带字符集的 JSON Content-Type 接受', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      const response = await handler(post({ contentType: 'application/json; charset=utf-8' }), ENV, NOW)

      expect(response.status).toBe(204)
    })
  })

  describe('配置', () => {
    it.each([
      ['缺少 measurement id', { GA_API_SECRET: 'secret' }],
      ['缺少 api secret', { GA_MEASUREMENT_ID: 'G-TEST123' }],
      ['空字符串算未配置', { GA_MEASUREMENT_ID: '', GA_API_SECRET: '' }],
    ])('%s 时明确失败而不是静默丢数据', async (_name, env) => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      const response = await handler(post(), env, NOW)

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ ok: false, error: 'not_configured' })
      expect(upstream.calls).toHaveLength(0)
    })
  })

  describe('请求体', () => {
    it('超过 64 KiB 拒绝', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(post({ body: 'x'.repeat(65 * 1024) }), ENV, NOW)

      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ ok: false, error: 'payload_too_large' })
    })

    it('无法解析的 JSON 拒绝', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(post({ body: '{ not json' }), ENV, NOW)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_json' })
    })

    it('带问题的报文回显前几条原因', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(post({ body: JSON.stringify({ events: [{ name: 'app_started' }] }) }), ENV, NOW)

      expect(response.status).toBe(400)
      const payload = (await response.json()) as { error: string; issues: string[] }
      expect(payload.error).toBe('invalid_payload')
      expect(payload.issues.length).toBeGreaterThan(0)
      expect(payload.issues.length).toBeLessThanOrEqual(5)
      expect(payload.issues[0]).toMatch(/^(events\.0\.|utils\.)/)
    })

    it('拒绝多余字段', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)

      const response = await handler(
        post({ body: JSON.stringify({ events: [appStarted()], extra: 1 }) }),
        ENV,
        NOW,
      )

      expect(response.status).toBe(400)
    })

    it('一批只能来自一台设备', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)
      const events = [appStarted(), appStarted({ installId: '9f2504e0-4f89-41d3-9a0c-0305e82c3302' })]

      const response = await handler(post({ events }), ENV, NOW)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'mixed_batch' })
    })

    it('节点类型是闭集：清单里的过，任意字符串不过', async () => {
      const handler = createTelemetryHandler(createUpstream().fetcher)
      // 故意不写成 TelemetryEvent：这里要发的正是**不合契约**的那一份。
      const nodeRun = (nodeKind: string) => ({ ...appStarted(), name: 'workflow_node_run', nodeKind })

      const accepted = await handler(post({ body: JSON.stringify({ events: [nodeRun('condition')] }) }), ENV, NOW)
      // 24 个字符的 URL 塞得进旧的 40 字符上限，这条用例验的就是那条缝已经封死。
      const rejected = await handler(
        post({ body: JSON.stringify({ events: [nodeRun('https://example.com/?q=1')] }) }),
        ENV,
        NOW,
      )

      expect(accepted.status).toBe(204)
      expect(rejected.status).toBe(400)
    })
  })

  describe('转发给下游', () => {
    it('成功时返回 204 且不带正文', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      const response = await handler(post(), ENV, NOW)

      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
    })

    it('凭证放在查询串里，正文里没有它们', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      await handler(post(), ENV, NOW)

      const [call] = upstream.calls
      const url = new URL(call.url)
      expect(url.pathname).toBe('/mp/collect')
      expect(url.searchParams.get('measurement_id')).toBe('G-TEST123')
      expect(url.searchParams.get('api_secret')).toBe('secret')
      expect(JSON.stringify(call.body)).not.toContain('secret')
    })

    it('client_id 用安装标识，地区、平台与安装级字段各有其位', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      await handler(post({ country: 'CN', events: [appStarted({ os: 'darwin', locale: 'zh-CN' })] }), ENV, NOW)

      const body = upstream.calls[0].body as {
        client_id: string
        user_properties: Record<string, { value: string }>
        user_location: { country_id: string }
        device: { category: string; operating_system: string; language: string }
        events: { name: string; params: Record<string, string | number>; timestamp_micros?: number }[]
      }
      expect(body.client_id).toBe(INSTALL_ID)
      expect(body.user_location.country_id).toBe('CN')
      expect(body.device).toEqual({ category: 'desktop', operating_system: 'Macintosh', language: 'zh-CN' })
      expect(body.events[0].name).toBe('app_started')
      // 只发契约里声明了去 param 的公共字段，其余各有去向（client_id / 时间戳 / device / user_properties）。
      expect(body.events[0].params).toMatchObject({ runtime: 'desktop' })
      expect(body.user_properties).toEqual({ version: { value: '1.1.0-beta.14' }, arch: { value: 'x64' } })
      expect(body.events[0].timestamp_micros).toBe((NOW - 1_000) * 1_000)
    })

    it('补上 GA 归属用户与会话所需的那两个参数', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)
      const events = [appStarted(), appStarted({ occurredAt: NOW - 500 })]

      await handler(post({ events }), ENV, NOW)

      const body = upstream.calls[0].body as { events: { params: Record<string, string | number> }[] }
      // `session_id` 必须是正整数（GA 要求匹配 ^\d+$），而且是**数字**不是字符串。
      const day = Math.floor(NOW / 86_400_000)
      expect(body.events[0].params.session_id).toBe(day)
      expect(typeof body.events[0].params.session_id).toBe('number')
      // 同一批里逐事件同值：会话是「收到时刻」的函数，不是「事件时刻」的函数。
      expect(body.events[1].params.session_id).toBe(day)
      expect(body.events[1].params.engagement_time_msec).toBe(body.events[0].params.engagement_time_msec)
      expect(typeof body.events[0].params.engagement_time_msec).toBe('number')
      expect(Number(body.events[0].params.engagement_time_msec)).toBeGreaterThan(0)
    })

    it('声明不用作个性化广告', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      await handler(post(), ENV, NOW)

      const body = upstream.calls[0].body as { consent: unknown; non_personalized_ads: unknown }
      expect(body.consent).toEqual({ ad_user_data: 'DENIED', ad_personalization: 'DENIED' })
      expect(body.non_personalized_ads).toBe(true)
    })

    it('用户的 IP 不进下游：位置只有一个国家代码', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      await handler(post({ address: '203.0.113.7', country: 'CN' }), ENV, NOW)

      const [call] = upstream.calls
      const serialized = JSON.stringify(call.body)
      // 转发请求从机房发出，所以「位置」必须由服务端显式给出；一旦给的是地址而不是国家代码，
      // GA 就会开始按 IP 定位，而那个 IP 不是用户的。
      expect(serialized).not.toContain('203.0.113.7')
      expect(serialized).not.toContain('ip_override')
      expect(call.body).toMatchObject({ user_location: { country_id: 'CN' } })
    })

    it('拿不到地区时发 XX 而不是留空', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      await handler(post(), ENV, NOW)

      const body = upstream.calls[0].body as { user_location: { country_id: string } }
      expect(body.user_location.country_id).toBe('XX')
    })

    it('格式不对的地区也退到 XX', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      await handler(post({ country: 'chn' }), ENV, NOW)

      const body = upstream.calls[0].body as { user_location: { country_id: string } }
      expect(body.user_location.country_id).toBe('XX')
    })

    it('业务属性原样进参数表', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)
      const modeChanged: TelemetryEvent = {
        name: 'route_mode_changed',
        occurredAt: NOW - 1_000,
        installId: INSTALL_ID,
        version: '1.1.0-beta.14',
        os: 'win32',
        arch: 'x64',
        locale: 'en',
        runtime: 'desktop',
        mode: 'workflow',
      }

      await handler(post({ events: [modeChanged] }), ENV, NOW)

      const body = upstream.calls[0].body as { events: { params: Record<string, string> }[] }
      expect(body.events[0].params).toMatchObject({ mode: 'workflow' })
    })

    it('超出回溯窗口的时间戳不带，事件本身照发', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)
      const old = appStarted({ occurredAt: NOW - 73 * 60 * 60 * 1000 })

      const response = await handler(post({ events: [old] }), ENV, NOW)

      expect(response.status).toBe(204)
      const body = upstream.calls[0].body as { events: { timestamp_micros?: number }[] }
      expect(body.events[0].timestamp_micros).toBeUndefined()
    })

    it('未来时间戳同样不带', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)
      const future = appStarted({ occurredAt: NOW + 60_000 })

      await handler(post({ events: [future] }), ENV, NOW)

      const body = upstream.calls[0].body as { events: { timestamp_micros?: number }[] }
      expect(body.events[0].timestamp_micros).toBeUndefined()
    })

    it('下游连不上与下游拒收都算 502', async () => {
      const failing = (async () => {
        throw new Error('network down')
      }) as typeof fetch
      const handler = createTelemetryHandler(failing)

      const response = await handler(post(), ENV, NOW)

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ ok: false, error: 'upstream_unreachable' })
    })

    it('下游 4xx 原样暴露状态码', async () => {
      const handler = createTelemetryHandler(createUpstream(400).fetcher)

      const response = await handler(post(), ENV, NOW)

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ ok: false, error: 'upstream_rejected', status: 400 })
    })
  })

  describe('限流', () => {
    it('同一安装标识超过每分钟上限后拒绝', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      for (let index = 0; index < 30; index += 1) {
        expect((await handler(post(), ENV, NOW)).status).toBe(204)
      }

      const limited = await handler(post(), ENV, NOW)
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).toBe('60')
      expect(upstream.calls).toHaveLength(30)
    })

    it('换一分钟窗口后恢复', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      for (let index = 0; index < 31; index += 1) await handler(post(), ENV, NOW)

      expect((await handler(post(), ENV, NOW + 60_001)).status).toBe(204)
    })

    it('按来源地址限流，与安装标识无关', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      for (let index = 0; index < 120; index += 1) {
        const events = [appStarted({ installId: crypto.randomUUID() })]
        expect((await handler(post({ events }), ENV, NOW)).status).toBe(204)
      }

      const events = [appStarted({ installId: crypto.randomUUID() })]
      expect((await handler(post({ events }), ENV, NOW)).status).toBe(429)
    })

    it('拿不到来源地址时跳过这一维度而不是共用一个假键', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      for (let index = 0; index < 121; index += 1) {
        const events = [appStarted({ installId: crypto.randomUUID() })]
        expect((await handler(post({ events, address: null }), ENV, NOW)).status).toBe(204)
      }
    })

    it('被拒绝的报文不计入下游', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler(upstream.fetcher)

      await handler(post({ events: [appStarted(), appStarted({ installId: crypto.randomUUID() })] }), ENV, NOW)

      expect(upstream.calls).toHaveLength(0)
    })
  })

  describe('生产入口', () => {
    it('默认导出指向那个有名字的入口', () => {
      // 部署后真正被调用的是这一条路径，单独写一个函数的价值在于它可被搜到；
      // 这条用例防的是「改了入口名、忘了改默认导出」这种改完就静默失效的情形。
      expect(entry.fetch).toBe(workerFetch)
    })

    it('错误路径在进下游之前就被拦住', async () => {
      // 入口用的是运行时 `fetch`，所以这里只能选一个必然在打网络之前就返回的用例。
      const response = await workerFetch(
        post({ url: 'https://api.osw.yinxulai.com/', method: 'GET', contentType: null }),
        ENV,
      )

      expect(response.status).toBe(404)
    })

    it('下游出事时留一行日志，但里面没有标识、没有地址、没有正文', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const handler = createTelemetryHandler(createUpstream(400).fetcher)

        await handler(post({ address: '203.0.113.7', country: 'CN' }), ENV, NOW)

        // `wrangler.toml` 把 `[observability]` 打开，等的就是这一行；而它同时承诺了日志里
        // 不问「谁在发」——这是那句承诺在测试里的落点。
        expect(logged).toHaveBeenCalledTimes(1)
        const line = String(logged.mock.calls[0][0])
        expect(line).toContain('upstream rejected status=400')
        expect(line).not.toContain(INSTALL_ID)
        expect(line).not.toContain('203.0.113.7')
      } finally {
        logged.mockRestore()
      }
    })
  })
})
