import { useState } from 'react'
import { Database, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { FormField, FormHint, FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface LogRetentionCardProps {
  retentionDays: number
  captureRequestContent: boolean
  onRetentionDaysChange: (value: number) => void
  onCaptureRequestContentChange: (value: boolean) => void
  onPrune: (days: number) => Promise<number | null>
}

export function LogRetentionCard(props: LogRetentionCardProps) {
  const {
    retentionDays,
    captureRequestContent,
    onRetentionDaysChange,
    onCaptureRequestContentChange,
    onPrune,
  } = props
  const [pruning, setPruning] = useState(false)
  const [pruneDialogOpen, setPruneDialogOpen] = useState(false)
  const [pruneDays, setPruneDays] = useState(String(retentionDays))

  async function handlePrune() {
    const days = Number(pruneDays)
    if (!Number.isInteger(days) || days < 1 || pruning) return
    setPruning(true)
    try {
      const deleted = await onPrune(days)
      if (deleted !== null) setPruneDialogOpen(false)
    } finally {
      setPruning(false)
    }
  }

  return (
    <Card>
      <SettingsCardHeader
        icon={<Database />}
        title="请求日志"
        description="控制请求记录范围、保留周期和历史数据清理"
        actions={<Badge variant="muted">仅限本机</Badge>}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title="自动保留周期"
          description="自动删除早于设定天数的请求日志"
          control={(
            <>
              <Input
                aria-label="自动保留天数"
                className="w-20 text-right"
                min={1}
                type="number"
                value={retentionDays}
                onChange={event => onRetentionDaysChange(Number(event.target.value))}
              />
              <span className="w-4 system-xs-regular text-text-tertiary">天</span>
            </>
          )}
        />

        <FormRow
          title="记录请求与响应正文"
          description="便于排查问题，但日志中可能包含敏感信息"
          control={<Switch checked={captureRequestContent} onCheckedChange={onCaptureRequestContentChange} />}
        />

        <FormRow
          title="清理历史日志"
          description="立即删除指定日期之前的历史记录，不影响自动保留设置"
          control={(
            <Button
              variant="outline"
              disabled={pruning}
              onClick={() => { setPruneDays(String(retentionDays)); setPruneDialogOpen(true) }}
            >
              <Trash2 />
              清理日志
            </Button>
          )}
        />
      </CardContent>
      <Dialog open={pruneDialogOpen} onOpenChange={open => !pruning && setPruneDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>按天数清理日志</DialogTitle>
            <DialogDescription>这次操作只影响已有历史记录，不会改变自动保留设置。</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <FormField label="保留最近" htmlFor="prune-retention-days">
              <div className="flex items-center gap-2">
                <Input id="prune-retention-days" type="number" min={1} value={pruneDays} onChange={event => setPruneDays(event.target.value)} autoFocus />
                <span className="shrink-0 system-sm-regular text-text-secondary">天的日志</span>
              </div>
              <FormHint>早于此时间的请求日志、尝试记录和正文会被删除，操作不可撤销。</FormHint>
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPruneDialogOpen(false)} disabled={pruning}>取消</Button>
            <Button onClick={() => void handlePrune()} disabled={pruning || !Number.isInteger(Number(pruneDays)) || Number(pruneDays) < 1}>
              {pruning ? '清理中...' : '确认清理'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
