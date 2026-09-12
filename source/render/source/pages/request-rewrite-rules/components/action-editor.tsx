import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { RuleAction, RuleActionOperation, RuleActionTarget } from '../types'

const operationLabels: Record<RuleActionOperation, string> = {
  set: '设置', append: '追加', remove: '删除', replace: '替换',
}

interface ActionEditorProps {
  actions: RuleAction[]
  onChange: (actions: RuleAction[]) => void
}

export function ActionEditor(props: ActionEditorProps) {
  const [deleteActionId, setDeleteActionId] = useState<string>()

  const updateAction = (id: string, patch: Partial<RuleAction>) => {
    props.onChange(props.actions.map(action => action.id === id ? { ...action, ...patch } : action))
  }

  const addAction = () => {
    props.onChange([...props.actions, { id: `action-${Date.now()}`, stage: 'request', target: 'header', operation: 'set', path: '', value: '' }])
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="system-sm-medium text-text-primary">动作</h3>
          <p className="mt-1 system-xs-regular text-text-tertiary">按列表顺序依次修改请求或响应内容。</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 system-xs-medium" onClick={addAction}>
          <Plus /> 添加动作
        </Button>
      </div>

      <div className="grid gap-2.5">
        {props.actions.length === 0 && (
          <div className="rounded-lg border border-dashed border-module-border px-4 py-8 text-center">
            <p className="system-xs-medium text-text-primary">还没有动作</p>
            <p className="mt-1 system-xs-regular text-text-tertiary">添加至少一个动作来修改 Header 或 JSON Body。</p>
          </div>
        )}
        {props.actions.map((action, index) => {
          const isHeader = action.target === 'header'
          const isRemove = action.operation === 'remove'
          const isReplace = action.operation === 'replace'
          const operations = isHeader ? (['set', 'append', 'remove'] as RuleActionOperation[]) : (['set', 'remove', 'replace'] as RuleActionOperation[])

          return (
            <div key={action.id} className="rounded-lg border border-module-border p-3">
              <div className="flex flex-wrap items-center gap-1.5 pb-3">
                <span className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md bg-inset font-mono system-2xs-medium text-text-tertiary">{index + 1}</span>
                <Select value={action.stage} onValueChange={value => updateAction(action.id, { stage: value as 'request' | 'response' })}>
                  <SelectTrigger aria-label={`动作 ${index + 1} 阶段`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="request">请求</SelectItem><SelectItem value="response">响应</SelectItem></SelectContent>
                </Select>
                <Select value={action.target} onValueChange={value => updateAction(action.id, { target: value as RuleActionTarget, operation: 'set', value: '' })}>
                  <SelectTrigger aria-label={`动作 ${index + 1} 目标`}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="header">Header</SelectItem><SelectItem value="body">Body</SelectItem></SelectContent>
                </Select>
                <Select value={action.operation} onValueChange={value => updateAction(action.id, { operation: value as RuleActionOperation })}>
                  <SelectTrigger aria-label={`动作 ${index + 1} 操作`}><SelectValue /></SelectTrigger>
                  <SelectContent>{operations.map(operation => <SelectItem key={operation} value={operation}>{operationLabels[operation]}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="删除动作" className="ml-auto text-text-tertiary hover:text-text-destructive" onClick={() => setDeleteActionId(action.id)}>
                  <Trash2 />
                </Button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <FormField label={isHeader ? 'Header 名称' : 'Body 路径'} htmlFor={`${action.id}-target`} className="sm:col-span-2">
                  <Input
                    id={`${action.id}-target`}
                    value={action.path}
                    onChange={event => updateAction(action.id, { path: event.target.value })}
                    placeholder={isHeader ? '例如 User-Agent' : '例如 $.metadata.source（当前支持 JSON Body）'}
                    className="font-mono placeholder:font-mono"
                  />
                </FormField>
                {!isRemove && (
                  <FormField
                    className={isReplace ? 'sm:col-span-2' : undefined}
                    label={isReplace ? '查找内容' : isHeader ? '值' : 'JSON 值'}
                    htmlFor={`${action.id}-value`}
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        id={`${action.id}-value`}
                        value={action.value ?? ''}
                        onChange={event => updateAction(action.id, { value: event.target.value })}
                        placeholder={isReplace ? '输入查找内容，例如 foo(\\d+)' : isHeader ? '输入 Header 值' : '例如 "text"、true、42 或 {"key":"value"}'}
                        className="min-w-0 flex-1 font-mono"
                      />
                      {isReplace && (
                        <label className="flex shrink-0 items-center gap-1.5 system-xs-regular text-text-tertiary">
                          <Switch checked={action.regex ?? false} onCheckedChange={regex => updateAction(action.id, { regex })} aria-label="使用正则表达式" />
                          正则
                        </label>
                      )}
                    </div>
                  </FormField>
                )}
                {isReplace && (
                  <FormField label="替换为" htmlFor={`${action.id}-replacement`} className="sm:col-span-2">
                    <Input
                      id={`${action.id}-replacement`}
                      value={action.replacement ?? ''}
                      onChange={event => updateAction(action.id, { replacement: event.target.value })}
                      placeholder="输入替换结果，可用 $1 引用捕获组"
                    />
                  </FormField>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <ConfirmDialog
        open={Boolean(deleteActionId)}
        title="删除这个动作？"
        description="该动作将从当前草稿中移除，保存规则后生效。"
        confirmLabel="删除动作"
        variant="destructive"
        onConfirm={() => {
          props.onChange(props.actions.filter(action => action.id !== deleteActionId))
          setDeleteActionId(undefined)
        }}
        onOpenChange={open => !open && setDeleteActionId(undefined)}
      />
    </section>
  )
}
