import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ProviderBundle } from '@common/provider-bundle'

interface ProviderImportDialogProps {
  fileName: string
  bundle: ProviderBundle
  existingProviderNames: string[]
  importing: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function ProviderImportDialog(props: ProviderImportDialogProps) {
  const { fileName, bundle, existingProviderNames, importing, onOpenChange, onConfirm } = props
  const existingNames = new Set(existingProviderNames)
  const overrideCount = bundle.providers.filter(provider => existingNames.has(provider.name)).length
  const keyCount = bundle.providers.filter(provider => provider.apiKey !== undefined).length

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入 {bundle.providers.length} 个供应商</DialogTitle>
          <DialogDescription className="truncate">来源文件：{fileName}</DialogDescription>
        </DialogHeader>

        <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {bundle.providers.map(provider => (
            <li key={provider.name} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
              <span className="min-w-0 truncate text-xs font-medium">{provider.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {provider.models.length} 个模型 · {existingNames.has(provider.name) ? '覆盖同名供应商' : '新建供应商'}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-xs leading-5 text-muted-foreground">
          {overrideCount > 0
            ? `其中 ${overrideCount} 个供应商与本地同名，将被整体覆盖：端点、自定义设置和模型都以包内容为准，包里没有的模型会被删除。`
            : '本地没有同名供应商，将全部新建。'}
          {keyCount > 0 ? `包内含 ${keyCount} 个明文 API Key，导入后会写入本地密钥库。` : '包内不含 API Key，同名供应商会沿用本地已有密钥。'}
        </p>

        <p className="text-xs leading-5 text-muted-foreground">
          新建的模型会挂到 default 逻辑模型；已有模型的调度位置不变。
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={importing}>
            {importing ? '导入中…' : '确认导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
