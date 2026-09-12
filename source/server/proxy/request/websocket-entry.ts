import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { createProtocolAuthHeaders } from '@common/protocols'
import { generateId } from '@common/utils'
import { listLogicalModels } from '@server/database/logical-model-store'
import { getSecretStore } from '@server/infrastructure/secrets/secret-store'
import type { AttemptView, ExchangeView, UpstreamConnection } from '@server/proxy/contracts'
import type { DeliveryMode } from '@server/proxy/contracts'
import { recordHealthFailure } from '@server/proxy/execution/attempt-outcome'
import { relayConnected, type RelayAttemptResult } from '@server/proxy/kernel/relay'
import { proxyTargetPlanner } from '@server/proxy/planners/target-planner'
import { matchProtocolEndpoint } from '@server/proxy/protocols/registry'
import { createUpstreamRequestHeaders } from '@server/proxy/response/headers'
import { getManualModel } from '@server/proxy/routing/manual-routing'
import { resolveLogicalModel } from '@server/proxy/routing/logical-model-resolver'
import { resolveTransport } from '@server/proxy/transports/registry'
import { acceptWebSocketUpgrade, readWebSocketHandshake, refuseWebSocketUpgrade } from '@server/proxy/transports/websocket-server-socket'

/**
 * 客户端 WS 握手自带的头。
 *
 * 它们是**逐跳**的：`Sec-WebSocket-Key` 是客户端与代理之间的随机数，代理与上游之间必须重新协商，
 * 转发过去会让上游看到两个 key 而拒绝握手；`extensions` 同理——两侧压缩各自协商，代理不承诺
 * 解开自己不认识的压缩。
 */
const WEBSOCKET_HANDSHAKE_HEADERS = [
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'sec-websocket-extensions',
]

/** 拒绝时的错误体，形状与 HTTP 入口的拒绝响应保持一致。 */
interface WebSocketRefusal {
  readonly statusCode: number
  readonly statusMessage: string
  readonly errorCode: string
  readonly errorMessage: string
}

/**
 * WS 升级入口。
 *
 * 一条客户端连接在**握手时**绑定一个 ProviderModel 端点，整条连接对应一条上游 WS 连接，
 * 连接内不做故障切换——续聊缓存（`previous_response_id`）是连接本地状态，跨连接转发会破坏
 * 链式语义。因此这里的职责只有四件事：认路径、请规划器给候选、连上游、双向搬运。
 *
 * 顺序上刻意**先连上游、后答客户端**：上游不支持 WS 时客户端必须收到一个 HTTP 拒绝（426），
 * 才能按 Codex 的降级行为回退到 HTTP + SSE；一旦回了 101 就再也发不出这个信号了。
 */
export async function handleWebSocketRequest(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
  const connectionId = generateId('ws_')
  const startedAt = Date.now()
  const pathname = readPathname(req.url)
  // `upgrade` 事件交出来的就是网络 socket（不是通用 `Duplex`），因此这里能直接读对端地址。
  const clientAddress = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`
  const refuse = (refusal: WebSocketRefusal, detail: string) => {
    console.warn(`[proxy-ws] upgrade refused connectionId=${connectionId} path=${pathname} client=${clientAddress} status=${refusal.statusCode} code=${refusal.errorCode} reason=${detail}`)
    refuseWebSocketUpgrade(socket, refusal.statusCode, refusal.statusMessage, JSON.stringify({
      success: false,
      errorCode: refusal.errorCode,
      errorMessage: refusal.errorMessage,
    }))
  }

  // 客户端在升级等待期间断开（或 socket 出错）时，别把已经建起的上游连接留在那里。
  let upstream: UpstreamConnection | null = null
  socket.on('error', error => {
    console.warn(`[proxy-ws] client socket failed connectionId=${connectionId} message=${error.message}`)
    upstream?.abort()
  })

  const endpoint = matchProtocolEndpoint('GET', pathname, 'websocket')
  if (!endpoint) {
    refuse({ statusCode: 404, statusMessage: 'Not Found', errorCode: 'UNKNOWN_API_PATH', errorMessage: `无法识别的 WebSocket 路径: ${pathname}` }, 'unknown-endpoint')
    return
  }
  if (!readWebSocketHandshake(req)) {
    // 例如 h2c 升级：这条路径上没有 WS 可服务，按「不是本端点的协议」拒绝。
    refuse({ statusCode: 426, statusMessage: 'Upgrade Required', errorCode: 'WEBSOCKET_HANDSHAKE_INVALID', errorMessage: '这不是一个合法的 WebSocket 握手请求' }, 'invalid-handshake')
    return
  }

  const protocol = endpoint.protocol
  // 握手阶段还没有任何报文，交付方式只由接口的封装描述决定（WS 封装恒为逐帧增量）。
  // 从封装描述取而不是写死一个 `true`：这个值将来若要按首帧解析，只有一个地方要改。
  const delivery: DeliveryMode = endpoint.envelope.resolveDelivery({ headers: req.headers, body: Buffer.alloc(0), url: null })
  // 握手阶段还没有任何报文，读不出请求模型（`readModel` 无从下手），因此这里必然走内建规则的回落分支。
  // 解析规则与 HTTP 入口共用 `resolveLogicalModel`：两条入口不再各写一份、也就不会再各自漂移。
  const resolution = resolveLogicalModel(await listLogicalModels(), null)
  if (!resolution) {
    refuse({ statusCode: 503, statusMessage: 'Service Unavailable', errorCode: 'NO_MODEL_CONFIGURED', errorMessage: '还没有配置已启用的 default 逻辑模型' }, 'no-default-logical-model')
    return
  }
  const logicalModel = resolution.logicalModel

  // 传输能力交给规划器判断：`transport: 'websocket'` 只给原生支持该协议的候选。
  // 「可转换候选」需要 WS ↔ HTTP 桥接，而「能降级就不桥接」是 P1 的明确取舍。
  const manualModelId = getManualModel(logicalModel.id)
  const plan = await proxyTargetPlanner.plan({ logicalModelId: logicalModel.id, clientProtocol: protocol, manualModelId, transport: 'websocket' })
  const target = plan.targets[0]
  if (!target) {
    refuse({ statusCode: 426, statusMessage: 'Upgrade Required', errorCode: 'NO_WEBSOCKET_UPSTREAM', errorMessage: plan.detail ?? `没有原生支持 ${protocol} 的可用 ProviderModel` }, `no-websocket-candidate reason=${plan.reason} manualModelId=${manualModelId ?? 'none'}`)
    return
  }

  const apiKey = await getSecretStore().get(target.apiKeyReference)
  const attempt: AttemptView = { index: 0, endpointId: target.endpointId, endpointProtocol: target.protocol }
  const exchange: ExchangeView = {
    // 连接即交换：WS 没有「一次请求」的粒度，一条连接就是一次交换单元。
    requestId: connectionId,
    logicalModelId: logicalModel.id,
    clientProtocol: protocol,
    transport: 'websocket',
    method: 'GET',
    path: pathname,
    headers: createUpstreamRequestHeaders(stripWebSocketHandshakeHeaders(req.headers), createProtocolAuthHeaders(protocol, apiKey, target.customAuthHeader), 0),
    body: Buffer.alloc(0),
    delivery,
    signal: new AbortController().signal,
  }

  try {
    upstream = await resolveTransport({ kind: 'websocket' }).connect(target, exchange, attempt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 握手失败是一次「上游不可用」的事实，必须计入健康冷却，口径与 HTTP attempt 一致。
    // 上游状态码拿不到（WS 客户端实现只报握手失败），因此按未知状态分类。
    const scope = await recordHealthFailure(target, null, null)
    console.warn(`[proxy-ws] upstream handshake failed connectionId=${connectionId} providerId=${target.providerId} providerModelId=${target.providerModelId} url=${target.url} scope=${scope} duration=${Date.now() - startedAt}ms message=${message}`)
    refuse({ statusCode: 426, statusMessage: 'Upgrade Required', errorCode: 'WEBSOCKET_UPSTREAM_UNAVAILABLE', errorMessage: `上游 WebSocket 握手失败: ${message}` }, `upstream-handshake-failed message=${message}`)
    return
  }

  const client = acceptWebSocketUpgrade(req, socket, head)
  if (!client) {
    upstream.abort()
    refuse({ statusCode: 426, statusMessage: 'Upgrade Required', errorCode: 'WEBSOCKET_HANDSHAKE_INVALID', errorMessage: '这不是一个合法的 WebSocket 握手请求' }, 'invalid-handshake')
    return
  }
  console.info(`[proxy-ws] connection established connectionId=${connectionId} client=${clientAddress} path=${pathname} logicalModelId=${logicalModel.id} providerId=${target.providerId} providerModelId=${target.providerModelId} upstreamUrl=${target.url} handshakeDuration=${Date.now() - startedAt}ms`)

  // 双向搬运交给内核：WS 与 HTTP 的差别只有「传输是双向的」，因此差别只在 `inbound` 有没有给。
  // 这里不再有第二个搬运循环——多一份实现就会多一份收尾规则，而收尾规则只有内核该知道。
  const relay = await relayConnected({
    // 连接即交换：WS 上没有比连接更小的重试单元，因此「待发请求」与「客户端投影」是同一份。
    request: exchange,
    exchange,
    attempt,
    target,
    connection: upstream,
    sink: client.sink,
    // P1 只有原生透传：请求重写规则与协议转换都不适用，因此「原样透传」就是「没有匹配的修改器」。
    modifiers: [],
    // WS 今天没有观察者，因为它还不走执行器，于是也没有落库与内容捕获、没有修改器链。
    // 这是这套模式剩下的最后一段，补齐的入口是执行器按 `target.transport` 取传输实现。
    observers: [],
    startedAt,
    inbound: {
      frames: client.frames,
      close: () => { client.destroy() },
    },
  })
  console.info(`[proxy-ws] connection closed connectionId=${connectionId} providerId=${target.providerId} providerModelId=${target.providerModelId} upstreamUrl=${target.url} reason=${describeCloseReason(relay)} duration=${Date.now() - startedAt}ms upstreamFrames=${relay.frameCount} upstreamBytes=${relay.byteCount} upstreamStopped=${relay.stopped} inboundFrames=${relay.inbound?.frameCount ?? 0} inboundBytes=${relay.inbound?.byteCount ?? 0} inboundStopped=${relay.inbound?.stopped ?? false}`)
}

/**
 * 断开原因：先看故障，再看是谁先结束的。
 *
 * 「谁先结束」由内核给出（`firstEnded`），不从两个摘要反推：两边都可能 `ended=false`，
 * 那种情况下无法区分「上游断了」与「客户端断了」。
 */
function describeCloseReason(relay: RelayAttemptResult): string {
  const error = relay.error ?? relay.inbound?.error ?? null
  if (error) return `error:${error.message}`
  if (relay.firstEnded === 'request') return relay.inbound?.ended ? 'client-closed' : 'client-interrupted'
  return relay.ended ? 'upstream-closed' : 'upstream-interrupted'
}

function readPathname(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname
  } catch {
    return '/'
  }
}

/** 剥掉客户端 WS 握手自带的头：上游握手由上游实现自己生成，这些逐跳头不能跟着走。 */
function stripWebSocketHandshakeHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const stripped: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!WEBSOCKET_HANDSHAKE_HEADERS.includes(name.toLowerCase())) stripped[name] = value
  }
  return stripped
}
