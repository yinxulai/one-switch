import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGroup, FormHint } from '@/components/form-kit'
import type { ProviderExportScope } from '../hooks/types'

interface ProviderExportDialogProps {
  scope: ProviderExportScope
  includeApiKeys: boolean
  exporting: boolean
  onIncludeApiKeysChange: (value: boolean) => void
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function ProviderExportDialog(props: ProviderExportDialogProps) {
  const { scope, includeApiKeys, exporting, onIncludeApiKeysChange, onOpenChange, onConfirm } = props
  const providerName = scope.kind === 'provider' ? scope.provider.name : null

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{providerName ? `导出供应商“${providerName}”` : '导出全部供应商'}</DialogTitle>
          <DialogDescription>
            导出内容包含供应商端点、下属模型、协议转换开关与自定义设置；逻辑模型和请求重写规则不属于供应商，不会进包。
          </DialogDescription>
        </DialogHeader>

        <FormGroup className="py-1">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-module-border bg-workflow-block-parma-bg p-3">
            <Checkbox
              checked={includeApiKeys}
              onCheckedChange={value => onIncludeApiKeysChange(value === true)}
              className="mt-0.5"
            />
            <span>
              <span className="block system-xs-medium text-text-primary">包含明文 API Key</span>
              <span className="mt-1 block system-xs-regular text-text-tertiary">
                导出的唯一目的是把供应商搬到另一台设备，不带密钥的包需要手工补填。带上密钥的文件等同于可用凭据，请勿通过公开渠道传输。
              </span>
            </span>
          </label>

          <FormHint>
            导入时同名供应商会被整体覆盖：包里没有的端点和模型会被删除，因此建议在目标设备确认后再导入。
          </FormHint>
        </FormGroup>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={exporting}>
            {exporting ? '导出中…' : '导出'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
