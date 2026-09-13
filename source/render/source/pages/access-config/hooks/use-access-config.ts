import { isWildcardHost, resolveProxyOrigin } from '@common/proxy-origin'
import { useProxyStatus } from '@/features/proxy/hooks'
import { useProxyToggle } from '../../logical-models/hooks/use-proxy-toggle'

/**
 * 接入配置页的数据源：把监听 host / port 拼成客户端能直接使用的地址。
 * 监听通配地址时它本身不是可访问地址，回落到 127.0.0.1，并把情况告诉调用方。
 */
export function useAccessConfig() {
  const proxyStatus = useProxyStatus()
  const { toggleProxy } = useProxyToggle()

  const host = proxyStatus?.host ?? ''
  const port = proxyStatus?.port ?? null

  return {
    running: proxyStatus?.running ?? false,
    host,
    port,
    wildcardHost: isWildcardHost(host),
    // 地址拼不出来时给空串：调用方（复制按钮）用空值判断要不要禁用。
    baseUrl: resolveProxyOrigin(host, port) ?? '',
    toggleProxy,
  }
}
