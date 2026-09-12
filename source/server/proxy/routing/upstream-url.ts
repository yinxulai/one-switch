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
