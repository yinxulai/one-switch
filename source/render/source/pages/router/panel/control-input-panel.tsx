import { Plus } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { DifyButton } from '../components/dify-button'
import { createControlItem } from '../graph-model'
import type { NodePanelProps } from '../node-data'
import type { ControlInputNode } from '../types'
import {
  NodePanelCard,
  NodePanelField,
  NodePanelGroupHeader,
  NodePanelHint,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

export function ControlInputPanel(props: NodePanelProps) {
  const { model, update } = props
  const node = model as ControlInputNode

  const patchControl = (controlId: string, patch: Record<string, unknown>) => {
    update(current => current.kind === 'control-input'
      ? {
        ...current,
        controls: current.controls.map(item => item.id === controlId ? { ...item, ...patch } : item),
      }
      : current)
  }

  return (
    <div className="grid gap-2.5">
      <NodePanelHint>
        控制输入节点会把开关、下拉等值写入 route.controls，供条件节点和其他逻辑引用。
      </NodePanelHint>

      <div className="grid gap-2.5">
        {node.controls.map((control, index) => (
          <NodePanelCard key={control.id}>
            <NodePanelGroupHeader
              title={`控制项 ${index + 1}`}
              action={(
                <DifyButton
                  variant="ghost-destructive"
                  onClick={() => update(current => current.kind === 'control-input'
                    ? { ...current, controls: current.controls.filter(item => item.id !== control.id) }
                    : current)}
                >
                  删除
                </DifyButton>
              )}
            />

            <NodePanelField label="键名">
              <Input value={control.key} onChange={event => patchControl(control.id, { key: event.target.value })} />
            </NodePanelField>

            <NodePanelField label="名称">
              <Input value={control.label} onChange={event => patchControl(control.id, { label: event.target.value })} />
            </NodePanelField>

            <div className="grid grid-cols-2 gap-2">
              <NodePanelField label="类型">
                <Select
                  value={control.kind}
                  onValueChange={value => update(current => current.kind === 'control-input'
                    ? {
                      ...current,
                      controls: current.controls.map(item => {
                        if (item.id !== control.id) return item
                        if (value === 'switch') {
                          return {
                            ...item,
                            kind: 'switch' as const,
                            defaultValue: typeof item.defaultValue === 'boolean' ? item.defaultValue : true,
                            options: undefined,
                          }
                        }
                        return {
                          ...item,
                          kind: 'select' as const,
                          defaultValue: typeof item.defaultValue === 'string'
                            ? item.defaultValue
                            : (item.options?.[0]?.value ?? 'balanced'),
                          options: item.options?.length
                            ? item.options
                            : [
                              { label: 'Balanced', value: 'balanced' },
                              { label: 'Fast', value: 'fast' },
                            ],
                        }
                      }),
                    }
                    : current)}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder="type" /></SelectTrigger>
                  <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                    <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="switch">开关</SelectItem>
                    <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} value="select">下拉</SelectItem>
                  </SelectContent>
                </Select>
              </NodePanelField>

              <div className="flex items-end justify-between gap-2 rounded-lg bg-workflow-block-parma-bg px-2.5 py-2">
                <span className="system-xs-regular text-text-secondary">启用</span>
                <Switch
                  checked={control.enabled}
                  onCheckedChange={checked => patchControl(control.id, { enabled: checked })}
                />
              </div>
            </div>

            {control.kind === 'switch' && (
              <div className="flex items-center justify-between rounded-lg bg-workflow-block-parma-bg px-2.5 py-2">
                <span className="system-xs-regular text-text-secondary">默认开启</span>
                <Switch
                  checked={Boolean(control.defaultValue)}
                  onCheckedChange={checked => patchControl(control.id, { defaultValue: checked })}
                />
              </div>
            )}

            {control.kind === 'select' && (
              <div className="grid gap-2.5">
                <NodePanelField label="默认值">
                  <Select
                    value={typeof control.defaultValue === 'string'
                      ? control.defaultValue
                      : (control.options?.[0]?.value ?? '')}
                    onValueChange={value => patchControl(control.id, { defaultValue: value })}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="default" /></SelectTrigger>
                    <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
                      {(control.options ?? []).map(option => (
                        <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </NodePanelField>

                <NodePanelField label="下拉选项（每行一个）">
                  <Textarea
                    value={(control.options ?? []).map(option => option.value).join('\n')}
                    onChange={(event) => {
                      const options = event.target.value
                        .split('\n')
                        .map(option => option.trim())
                        .filter(Boolean)
                        .map(option => ({ label: option, value: option }))
                      patchControl(control.id, { options, defaultValue: options[0]?.value ?? '' })
                    }}
                    className="min-h-24"
                  />
                </NodePanelField>
              </div>
            )}
          </NodePanelCard>
        ))}
      </div>

      <DifyButton
        onClick={() => update(current => current.kind === 'control-input'
          ? { ...current, controls: [...current.controls, createControlItem('switch')] }
          : current)}
      >
        <Plus className="size-3.5" aria-hidden /> 添加控制项
      </DifyButton>
    </div>
  )
}
