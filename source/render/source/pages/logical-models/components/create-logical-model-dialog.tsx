import { useState } from 'react'
import { LogicalModelIdSchema } from '@common/schemas'
import { logicalModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const createLogicalModel = async () => {
    const trimmedId = id.trim()
    const validation = LogicalModelIdSchema.safeParse(trimmedId)
    if (!validation.success) {
      toast.error(validation.error.issues[0]?.message ?? '请输入有效的逻辑模型 ID')
      return
    }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建逻辑模型</DialogTitle>
          <DialogDescription>逻辑模型 ID 是稳定标识。创建后不会自动加入模型，请在逻辑模型卡片中显式添加模型并配置调度策略。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="logical-model-id">逻辑模型 ID</Label>
            <Input id="logical-model-id" value={id} onChange={event => setId(event.target.value)} placeholder="例如：production" autoFocus />
            <p className="text-xs text-muted-foreground">以小写字母开头，只能包含小写字母、数字、下划线和连字符，最多 64 个字符。</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="logical-model-description">描述（可选）</Label>
            <Input id="logical-model-description" value={description} onChange={event => setDescription(event.target.value)} placeholder="说明这个逻辑模型的用途" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={saving} onClick={() => void createLogicalModel()}>{saving ? '创建中…' : '创建逻辑模型'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
