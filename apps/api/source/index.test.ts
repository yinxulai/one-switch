import { describe, expect, it } from 'vitest'
import type { TelemetryEvent } from '@common/telemetry'
import { createTelemetryHandler, type TelemetryEnv } from './index'

const NOW = 1_700_000_000_000
const INSTALL_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const ENDPOINT = 'https://telemetry.one-switch.app/v1/events'
const ENV: TelemetryEnv = { GA_MEASUREMENT_ID: 'G-TEST123', GA_API_SECRET: 'secret' }

interface CapturedRequest {
  url: string
  body: unknown
  method: string | undefined
}

/** 下游替身。返回给定状态码，并把收到的请求留下来给断言用。 */
function createUpstream(status = 204): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    return new Response(null, { status })
  }) as typeof fetch
  return { fetchImpl, calls }
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

/** 打健康检查的请求。`GET` / `HEAD` 不带正文，其余方法带（405 在读正文之前就判了）。 */
function health(method = 'GET'): Request {
  return post({ url: 'https://telemetry.one-switch.app/health', method, contentType: null })
}

describe('上报端点', () => {
  describe('健康检查与路由', () => {
    it('GET /health 直接回答，不碰下游也不进限流', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      // 密钥一个都没给：探针的职责是「活着吗」，不是「配好了吗」，所以这里仍然要能回答。
      const response = await handler(health(), {}, NOW)

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ ok: true, upstream: 'unconfigured' })
      expect(upstream.calls).toHaveLength(0)
    })

    it('健康检查报出自己的版本', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const payload = (await (await handler(health(), ENV, NOW)).json()) as { version: string }

      // 不写死版本号：那是 `package.json` 的事，这里断言的是「它确实来自那份清单」。
      expect(payload.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('密钥齐了就把 upstream 报成 configured', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const payload = (await (await handler(health(), ENV, NOW)).json()) as { upstream: string }

      expect(payload.upstream).toBe('configured')
    })

    it('HEAD /health 有状态码没有正文', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const response = await handler(health('HEAD'), ENV, NOW)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(await response.text()).toBe('')
    })

    it('POST /health 只允许 GET 与 HEAD', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const response = await handler(health('POST'), ENV, NOW)

      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET, HEAD')
    })

    it('根路径不再被占，与任何未知路径一样 404', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const response = await handler(
        post({ url: 'https://telemetry.one-switch.app/', method: 'GET', contentType: null }),
        ENV,
        NOW,
      )

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
    })

    it('未知路径 404', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const response = await handler(post({ url: 'https://telemetry.one-switch.app/v2/events' }), ENV, NOW)

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
    })

    it('GET /v1/events 只允许 POST', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const response = await handler(post({ method: 'GET' }), ENV, NOW)

      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
    })

    it('非 JSON 的 Content-Type 拒绝', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const response = await handler(post({ contentType: 'text/plain' }), ENV, NOW)

      expect(response.status).toBe(415)
    })

    it('带字符集的 JSON Content-Type 接受', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

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
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      const response = await handler(post(), env, NOW)

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ ok: false, error: 'not_configured' })
      expect(upstream.calls).toHaveLength(0)
    })
  })

  describe('请求体', () => {
    it('超过 64 KiB 拒绝', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const response = await handler(post({ body: 'x'.repeat(65 * 1024) }), ENV, NOW)

      expect(response.status).toBe(413)
      expect(await response.json()).toEqual({ ok: false, error: 'payload_too_large' })
    })

    it('无法解析的 JSON 拒绝', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const response = await handler(post({ body: '{ not json' }), ENV, NOW)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'invalid_json' })
    })

    it('带问题的报文回显前几条原因', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const response = await handler(post({ body: JSON.stringify({ events: [{ name: 'app_started' }] }) }), ENV, NOW)

      expect(response.status).toBe(400)
      const payload = (await response.json()) as { error: string; issues: string[] }
      expect(payload.error).toBe('invalid_payload')
      expect(payload.issues.length).toBeGreaterThan(0)
      expect(payload.issues.length).toBeLessThanOrEqual(5)
      expect(payload.issues[0]).toMatch(/^(events\.0\.|utils\.)/)
    })

    it('拒绝多余字段', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })

      const response = await handler(
        post({ body: JSON.stringify({ events: [appStarted()], extra: 1 }) }),
        ENV,
        NOW,
      )

      expect(response.status).toBe(400)
    })

    it('一批只能来自一台设备', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream().fetchImpl })
      const events = [appStarted(), appStarted({ installId: '9f2504e0-4f89-41d3-9a0c-0305e82c3302' })]

      const response = await handler(post({ events }), ENV, NOW)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, error: 'mixed_batch' })
    })
  })

  describe('转发给下游', () => {
    it('成功时返回 204 且不带正文', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      const response = await handler(post(), ENV, NOW)

      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
    })

    it('凭证放在查询串里，正文里没有它们', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      await handler(post(), ENV, NOW)

      const [call] = upstream.calls
      const url = new URL(call.url)
      expect(url.pathname).toBe('/mp/collect')
      expect(url.searchParams.get('measurement_id')).toBe('G-TEST123')
      expect(url.searchParams.get('api_secret')).toBe('secret')
      expect(JSON.stringify(call.body)).not.toContain('secret')
    })

    it('client_id 用安装标识，地区与平台来自服务端观察到的值', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      await handler(post({ country: 'CN', events: [appStarted({ os: 'darwin', locale: 'zh-CN' })] }), ENV, NOW)

      const body = upstream.calls[0].body as {
        client_id: string
        user_location: { country_id: string }
        device: { operating_system: string; language: string }
        events: { name: string; params: Record<string, string>; timestamp_micros?: number }[]
      }
      expect(body.client_id).toBe(INSTALL_ID)
      expect(body.user_location.country_id).toBe('CN')
      expect(body.device).toEqual({ operating_system: 'Macintosh', language: 'zh-CN' })
      expect(body.events[0].name).toBe('app_started')
      // 只发契约里声明了去 param 的公共字段，其余各有去向（client_id / 时间戳 / device）。
      expect(body.events[0].params).toEqual({
        version: '1.1.0-beta.14',
        arch: 'x64',
        runtime: 'desktop',
      })
      expect(body.events[0].timestamp_micros).toBe((NOW - 1_000) * 1_000)
    })

    it('拿不到地区时发 XX 而不是留空', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      await handler(post(), ENV, NOW)

      const body = upstream.calls[0].body as { user_location: { country_id: string } }
      expect(body.user_location.country_id).toBe('XX')
    })

    it('格式不对的地区也退到 XX', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      await handler(post({ country: 'chn' }), ENV, NOW)

      const body = upstream.calls[0].body as { user_location: { country_id: string } }
      expect(body.user_location.country_id).toBe('XX')
    })

    it('业务属性原样进参数表', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })
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
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })
      const old = appStarted({ occurredAt: NOW - 73 * 60 * 60 * 1000 })

      const response = await handler(post({ events: [old] }), ENV, NOW)

      expect(response.status).toBe(204)
      const body = upstream.calls[0].body as { events: { timestamp_micros?: number }[] }
      expect(body.events[0].timestamp_micros).toBeUndefined()
    })

    it('未来时间戳同样不带', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })
      const future = appStarted({ occurredAt: NOW + 60_000 })

      await handler(post({ events: [future] }), ENV, NOW)

      const body = upstream.calls[0].body as { events: { timestamp_micros?: number }[] }
      expect(body.events[0].timestamp_micros).toBeUndefined()
    })

    it('排查模式才要求 GA 反馈', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      await handler(post(), { ...ENV, TELEMETRY_STRICT_VALIDATION: '1' }, NOW)

      const body = upstream.calls[0].body as { validation_behavior?: string }
      expect(body.validation_behavior).toBe('ENFORCE_RECOMMENDATIONS')
    })

    it('默认不带排查模式字段', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      await handler(post(), ENV, NOW)

      const body = upstream.calls[0].body as { validation_behavior?: string }
      expect(body.validation_behavior).toBeUndefined()
    })

    it('下游连不上与下游拒收都算 502', async () => {
      const failing = (async () => {
        throw new Error('network down')
      }) as typeof fetch
      const handler = createTelemetryHandler({ fetchImpl: failing })

      const response = await handler(post(), ENV, NOW)

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ ok: false, error: 'upstream_unreachable' })
    })

    it('下游 4xx 原样暴露状态码', async () => {
      const handler = createTelemetryHandler({ fetchImpl: createUpstream(400).fetchImpl })

      const response = await handler(post(), ENV, NOW)

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ ok: false, error: 'upstream_rejected', status: 400 })
    })
  })

  describe('限流', () => {
    it('同一安装标识超过每分钟上限后拒绝', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

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
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      for (let index = 0; index < 31; index += 1) await handler(post(), ENV, NOW)

      expect((await handler(post(), ENV, NOW + 60_001)).status).toBe(204)
    })

    it('按来源地址限流，与安装标识无关', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      for (let index = 0; index < 120; index += 1) {
        const events = [appStarted({ installId: crypto.randomUUID() })]
        expect((await handler(post({ events }), ENV, NOW)).status).toBe(204)
      }

      const events = [appStarted({ installId: crypto.randomUUID() })]
      expect((await handler(post({ events }), ENV, NOW)).status).toBe(429)
    })

    it('拿不到来源地址时跳过这一维度而不是共用一个假键', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      for (let index = 0; index < 121; index += 1) {
        const events = [appStarted({ installId: crypto.randomUUID() })]
        expect((await handler(post({ events, address: null }), ENV, NOW)).status).toBe(204)
      }
    })

    it('被拒绝的报文不计入下游', async () => {
      const upstream = createUpstream()
      const handler = createTelemetryHandler({ fetchImpl: upstream.fetchImpl })

      await handler(post({ events: [appStarted(), appStarted({ installId: crypto.randomUUID() })] }), ENV, NOW)

      expect(upstream.calls).toHaveLength(0)
    })
  })
})
