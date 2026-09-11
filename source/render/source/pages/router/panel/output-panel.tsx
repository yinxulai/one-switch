import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NodePanelProps } from '../node-data'
import type { OutputNode } from '../types'
import { NodePanelField, NodePanelSwitchRow } from './panel-fields'

export function OutputPanel(props: NodePanelProps) {
  const { model, update } = props
  const node = model as OutputNode

  return (
    <div className="grid gap-2.5">
      <NodePanelSwitchRow
        label="附带完整 Trace"
        checked={node.includeTrace}
        onCheckedChange={checked => update(current => current.kind === 'output' ? { ...current, includeTrace: checked } : current)}
      />

      <NodePanelField label="摘要级别">
        <Select
          value={node.summaryLevel}
          onValueChange={value => update(current => current.kind === 'output'
            ? { ...current, summaryLevel: value as OutputNode['summaryLevel'] }
            : current)}
        >
          <SelectTrigger className="w-full"><SelectValue placeholder="summary" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="brief">简要</SelectItem>
            <SelectItem value="detailed">详细</SelectItem>
          </SelectContent>
        </Select>
      </NodePanelField>
    </div>
  )
}
