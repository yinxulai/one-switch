import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FORM_DIALOG_BODY_CLASSNAME, FormGroup } from '@/components/form-kit'
import { ProviderEndpointCard } from './provider-endpoint-card'
import { ProviderFields } from './provider-fields'
import type { ProviderEndpointEntry } from '../hooks/types'

interface ProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingProviderId: string | null
  providerName: string
  apiKey: string
  timeout: string
  endpointEntries: ProviderEndpointEntry[]
  saving: boolean
  setProviderName: (name: string) => void
  setApiKey: (key: string) => void
  setTimeout: (timeout: string) => void
  updateEndpointEntry: (index: number, patch: Partial<ProviderEndpointEntry>) => void
  onCancel: () => void
  onSave: () => void
}

export function ProviderDialog(props: ProviderDialogProps) {
  const {
    open,
    onOpenChange,
    editingProviderId,
    providerName,
    apiKey,
    timeout,
    endpointEntries,
    saving,
    setProviderName,
    setApiKey,
    setTimeout,
    updateEndpointEntry,
    onCancel,
    onSave,
  } = props

  const canSave = Boolean(providerName.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        onPointerDownOutside={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{editingProviderId ? '编辑供应商' : '新建供应商'}</DialogTitle>
          <DialogDescription>API Key 可选；本地或测试集群等无需鉴权的上游可以留空。</DialogDescription>
        </DialogHeader>

        <div className={FORM_DIALOG_BODY_CLASSNAME}>
          <ProviderFields
            editingProviderId={editingProviderId}
            providerName={providerName}
            apiKey={apiKey}
            timeout={timeout}
            setProviderName={setProviderName}
            setApiKey={setApiKey}
            setTimeout={setTimeout}
          />

          {/* 协议默认地址 */}
          <FormGroup
            title="支持的协议默认接口地址"
            description="开启某个协议并填入默认地址；添加模型选择该协议时如不覆盖则沿用此地址。"
          >
            {endpointEntries.map((entry, index) => (
              <ProviderEndpointCard
                key={entry.protocol}
                entry={entry}
                index={index}
                updateEndpointEntry={updateEndpointEntry}
              />
            ))}
          </FormGroup>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button disabled={saving || !canSave} onClick={onSave}>
            {saving ? '保存中...' : editingProviderId ? '保存修改' : '创建供应商'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
