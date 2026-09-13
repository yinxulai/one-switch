import { useProxyStatus } from '@/features/proxy/hooks'
import { useProxyToggle } from '../../logical-models/hooks/use-proxy-toggle'

const WILDCARD_HOSTS = ['0.0.0.0', '::', '[::]']
const LOOPBACK_HOST = '127.0.0.1'

/**
 * 接入配置页的数据源：把监听 host / port 拼成客户端能直接使用的地址。
 * 监听 0.0.0.0 时它本身不是可访问地址，回落到 127.0.0.1，并把情况告诉调用方。
 */
export function useAccessConfig() {
  const proxyStatus = useProxyStatus()
  const { toggleProxy } = useProxyToggle()

  const host = proxyStatus?.host ?? ''
  const port = proxyStatus?.port ?? null
  const wildcardHost = WILDCARD_HOSTS.includes(host)
  const clientHost = wildcardHost ? LOOPBACK_HOST : host
  const baseUrl = clientHost && port !== null ? `http://${clientHost}:${port}` : ''

  return {
    running: proxyStatus?.running ?? false,
    host,
    port,
    wildcardHost,
    baseUrl,
    toggleProxy,
  }
}
