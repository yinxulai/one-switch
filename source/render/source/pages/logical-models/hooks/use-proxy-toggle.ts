import { useCallback } from 'react'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'
import { useProxyActions, useProxyStatus } from '@/features/proxy/hooks'

export function useProxyToggle() {
  const toast = useToast()
  const t = useTranslation()
  const proxyStatus = useProxyStatus()
  const proxyActions = useProxyActions()

  const toggleProxy = useCallback(async () => {
    const result = proxyStatus?.running
      ? await proxyActions.stop()
      : await proxyActions.start()
    if (!result.success) {
      toast.error(result.errorMessage)
      return
    }
    toast.success(result.data.running ? t('logicalModels.proxy.started') : t('logicalModels.proxy.stopped'))
  }, [proxyActions, proxyStatus, t, toast])

  const proxyBaseUrl = proxyStatus ? `http://${proxyStatus.host}:${proxyStatus.port}` : ''

  return { proxyStatus, proxyBaseUrl, toggleProxy }
}
