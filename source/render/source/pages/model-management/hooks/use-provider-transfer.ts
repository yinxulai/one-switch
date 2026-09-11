import { useCallback, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { providerTransferApi } from '@/api/providers'
import { unwrap } from '@/api/unwrap'
import { useToast } from '@/components/ui/toast'
import { ProviderBundleSchema } from '@common/provider-bundle'
import type { ProviderBundle, ProviderBundleExportRequest } from '@common/provider-bundle'
import type { ProviderExportScope } from './types'

interface PendingImport {
  fileName: string
  bundle: ProviderBundle
}

interface ProviderTransferOptions {
  reload: () => Promise<void>
}

/**
 * 供应商包导入导出。
 *
 * 客户端先解析文件并给出预览再提交：导入是「同名整体覆盖」的破坏性操作，让用户在真正提交前看到
 * 包里有哪些供应商，比导入完再后悔要好。文件内容仍由服务端重新校验，这里的解析只是预览。
 */
export function useProviderTransfer(options: ProviderTransferOptions) {
  const { reload } = options
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [includeApiKeys, setIncludeApiKeys] = useState(true)
  const [exportScope, setExportScope] = useState<ProviderExportScope | null>(null)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)

  const exportMutation = useMutation({
    mutationFn: (input: ProviderBundleExportRequest) => unwrap(providerTransferApi.export(input)),
  })
  const importMutation = useMutation({
    mutationFn: (bundle: ProviderBundle) => unwrap(providerTransferApi.import(bundle)),
  })

  const openExportDialog = useCallback((scope: ProviderExportScope) => setExportScope(scope), [])
  const closeExportDialog = useCallback(() => setExportScope(null), [])
  const openImportFilePicker = useCallback(() => fileInputRef.current?.click(), [])
  const closeImportDialog = useCallback(() => setPendingImport(null), [])

  const confirmExport = useCallback(async () => {
    if (!exportScope) return
    const providerIds = exportScope.kind === 'provider' ? [exportScope.provider.id] : undefined
    try {
      const data = await exportMutation.mutateAsync({ providerIds, includeApiKeys })
      const names = data.bundle.providers.map(provider => provider.name)
      downloadText(data.content, bundleFileName(names.length === 1 ? names[0] : null))
      toast.success(names.length === 1 ? `已导出供应商“${names[0]}”` : `已导出 ${names.length} 个供应商`)
      setExportScope(null)
    } catch (error) {
      toast.error(`导出失败：${errorText(error)}`)
    }
  }, [exportMutation, exportScope, includeApiKeys, toast])

  const prepareImport = useCallback(async (file: File) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      toast.error('导入失败：文件内容不是合法的 JSON')
      return
    }

    const result = ProviderBundleSchema.safeParse(parsed)
    if (!result.success) {
      toast.error('导入失败：这不是一个可识别的供应商导出文件')
      return
    }
    setPendingImport({ fileName: file.name, bundle: result.data })
  }, [toast])

  const confirmImport = useCallback(async () => {
    if (!pendingImport) return
    try {
      const data = await importMutation.mutateAsync(pendingImport.bundle)
      toast.success(`已导入 ${data.imported.providers} 个供应商 / ${data.imported.models} 个供应商模型`)
      setPendingImport(null)
      await reload()
    } catch (error) {
      toast.error(`导入失败：${errorText(error)}`)
    }
  }, [importMutation, pendingImport, reload, toast])

  return {
    fileInputRef,
    includeApiKeys,
    setIncludeApiKeys,
    exportScope,
    pendingImport,
    exporting: exportMutation.isPending,
    importing: importMutation.isPending,
    openExportDialog,
    closeExportDialog,
    openImportFilePicker,
    closeImportDialog,
    confirmExport,
    prepareImport,
    confirmImport,
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 文件名只去掉各平台不允许的字符：供应商名常常是中文，不该被改写成下划线。 */
function sanitizeFileName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'provider'
}

function bundleFileName(providerName: string | null): string {
  const date = new Date().toISOString().slice(0, 10)
  if (!providerName) return `one-switch-providers-${date}.json`
  return `one-switch-provider-${sanitizeFileName(providerName)}-${date}.json`
}

function downloadText(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
