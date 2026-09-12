import { useState } from 'react'
import { LogicalModelIdSchema } from '@common/schemas'
import { logicalModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

interface CreateLogicalModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function CreateLogicalModelDialog(props: CreateLogicalModelDialogProps) {
  const { open, onOpenChange, onCreated } = props
  const toast = useToast()
  const [id, setId] = useState('')
  const [idError, setIdError] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    // 关闭时清掉校验态，避免下次打开残留上一次的报错。
    if (!nextOpen) setIdError('')
    onOpenChange(nextOpen)
  }

  const createLogicalModel = async () => {
    const trimmedId = id.trim()
    const validation = LogicalModelIdSchema.safeParse(trimmedId)
    if (!validation.success) {
      // 就地提示错误，避免只弹 toast 让用户找不到出错的字段。
      const message = validation.error.issues[0]?.message ?? '请输入有效的逻辑模型 ID'
      setIdError(message)
      toast.error(message)
      return
    }
    setIdError('')
    setSaving(true)
    try {
      await unwrap(logicalModelApi.create({ id: trimmedId, description: description.trim() }))
      toast.success('逻辑模型已创建，请为逻辑模型添加模型')
      setId('')
      setDescription('')
      onOpenChange(false)
      onCreated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建逻辑模型</DialogTitle>
          <DialogDescription>逻辑模型 ID 是稳定标识。创建后不会自动加入模型，请在逻辑模型卡片中显式添加模型并配置调度策略。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField
            label="逻辑模型 ID"
            htmlFor="logical-model-id"
            error={idError}
            required
            hint="以小写字母开头，只能包含小写字母、数字、下划线和连字符，最多 64 个字符。"
          >
            <Input
              id="logical-model-id"
              value={id}
              aria-invalid={Boolean(idError)}
              onChange={event => { setId(event.target.value); if (idError) setIdError('') }}
              placeholder="例如：production"
              autoFocus
            />
          </FormField>
          <FormField label="描述（可选）" htmlFor="logical-model-description">
            <Input
              id="logical-model-description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder="说明这个逻辑模型的用途"
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>取消</Button>
          <Button disabled={saving} onClick={() => void createLogicalModel()}>{saving ? '创建中…' : '创建逻辑模型'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
