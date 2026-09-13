import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PruneRequestLogsParams } from '@/api/observability'
import { requestLogApi } from '@/api/observability'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'

export type PruneRequestLogsResult = { deletedLogs: number; deletedContents: number }

export function useRequestLogRetention() {
  const toast = useToast()
  const t = useTranslation()
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: (params: PruneRequestLogsParams) => unwrap(requestLogApi.prune(params)),
    onSuccess: async data => {
      toast.success(t('settings.logs.pruneSuccess', { logs: data.deletedLogs, contents: data.deletedContents }))
      await Promise.all([client.invalidateQueries({ queryKey: ['request-logs'] }), client.invalidateQueries({ queryKey: ['analytics'] }), client.invalidateQueries({ queryKey: ['logical-model-metrics'] })])
    },
    onError: error => toast.error(t('settings.logs.pruneFailed', { message: error.message })),
  })
  const pruneLogs = useCallback(async (params: PruneRequestLogsParams): Promise<PruneRequestLogsResult | null> => {
    try { return await mutation.mutateAsync(params) } catch { return null }
  }, [mutation])
  return { pruneLogs }
}
