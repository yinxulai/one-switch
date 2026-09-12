import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { developmentApi } from '@/api/tools'
import { unwrap } from '@/api/unwrap'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n/provider'

export function useDevelopmentSeed(reload: () => Promise<void>) {
  const toast = useToast()
  const t = useTranslation()
  const confirm = useConfirm()
  const mutation = useMutation({
    mutationFn: () => unwrap(developmentApi.seed()),
    onSuccess: async data => {
      toast.success(data.inserted ? t('settings.development.seedInserted') : t('settings.development.seedExisting'))
      await reload()
    },
    onError: error => toast.error(t('settings.development.seedFailed', { message: error.message })),
  })
  const seedDevelopmentData = useCallback(async () => {
    const confirmed = await confirm({
      title: t('settings.development.seedTitle'),
      description: t('settings.development.seedConfirmDescription'),
      confirmLabel: t('settings.development.seedConfirm'),
    })
    if (!confirmed) return
    await mutation.mutateAsync().catch(() => undefined)
  }, [confirm, mutation, t])
  return { seedDevelopmentData }
}
