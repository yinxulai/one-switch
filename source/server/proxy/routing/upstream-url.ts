import type { TransportKind } from '@common/schemas'

/**
 * 规范化上游 URL。
 *
 * 上游地址完全由「端点配置」决定，不拼接客户端请求的路径：这一层不做路径映射，
 * 客户端打哪个路径进来、就发到端点配置的那个地址上去。
 *
 * 非法协议（`file:` 之类）在这里就拒掉：这一层是唯一有资格判断「这个地址能不能拿去发请求」的地方。
 */
export function resolveUpstreamUrl(upstreamUrl: string): string {
  const parsed = new URL(upstreamUrl)

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported upstream URL protocol: ${parsed.protocol}`)
  }

  return parsed.toString()
}

/**
 * 上游地址是否指向一个 WebSocket 端点。
 *
 * `ws://` / `wss://` 是唯一的依据：连接形态由地址本身表达，一个地址只有一种形态，
 * 它也不是可配置项。写错的地址一律按 HTTP 处理——那一跳自己会失败，不该由这里报错。
 */
export function isWebSocketEndpoint(upstreamUrl: string): boolean {
  return /^wss?:\/\//i.test(upstreamUrl)
}

/**
 * 上游跳的传输形态。**全仓唯一一处「上游形态从哪来」的答案。**
 *
 * 两句话：
 * - 端点是 `ws(s)://` → `'websocket'`。客户端说要什么形态都改变不了一个 WebSocket 端点；
 * - 其余地址 → 客户端跳是什么形态，上游跳就是什么形态。这是「忠实转发」的直接后果：
 *   我们不替上游决定它该回整包还是逐帧，客户端要 SSE 就把带 `stream` 的请求原样发过去。
 */
export function resolveUpstreamTransport(upstreamUrl: string, clientTransport: TransportKind): TransportKind {
  return isWebSocketEndpoint(upstreamUrl) ? 'websocket' : clientTransport
}
