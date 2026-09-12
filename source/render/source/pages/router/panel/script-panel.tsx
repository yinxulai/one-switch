import { useCallback, useMemo } from 'react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { NodePanelProps } from '../node-data'
import { SCRIPT_TIMEOUT_LIMIT, type ScriptNode } from '@common/router/types'
import { PanelCodeEditor } from './panel-code-editor'
import {
  NodePanelField,
  NodePanelHint,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

/**
 * JS 脚本节点面板。
 *
 * 只暴露「代码 + 写回路径 + 超时」三件事：脚本能拿到的就是一个 payload 深拷贝、
 * 一个 `get(路径)` 和一个 `console`，多出来的自由度（网络 / 文件）一律不给。
 */
export function ScriptPanel(props: NodePanelProps) {
  const { model, conditionFieldHints, update } = props
  const node = model.kind === 'script' ? model : undefined
  const code = node?.code ?? ''
  const resultPath = node?.resultPath ?? ''
  const timeoutMilliseconds = node?.timeoutMilliseconds ?? 2_000

  const patch = useCallback((patchValue: Partial<ScriptNode>) => {
    update(current => current.kind === 'script' ? { ...current, ...patchValue } : current)
  }, [update])

  /** 取值候选：脚本主要用来读取上游产出，所有已知字段都值得列出来。 */
  const sourceFields = useMemo(
    () => conditionFieldHints.filter(field => field.valueType !== 'object'),
    [conditionFieldHints],
  )

  const handleCodeChange = useCallback((next: string) => patch({ code: next }), [patch])

  /** 写回候选：脚本结果类型未知，任何字段路径都可以作为落点。 */
  const resultFields = useMemo(() => conditionFieldHints, [conditionFieldHints])

  if (!node) return null

  return (
    <div className="grid gap-2.5">
      <NodePanelHint>
        沙箱里可用
        {' '}
        <span className="font-mono">payload</span>
        （本次运行数据的深拷贝）、
        <span className="font-mono">get(路径)</span>
        （支持
        <span className="font-mono">a[*].b</span>
        通配投影）与
        <span className="font-mono">console</span>
        。用
        {' '}
        <span className="font-mono">return</span>
        {' '}
        交回结果，写入下方路径。代码框内输入
        {' '}
        <span className="font-mono">{"get('"}</span>
        {' '}
        或按
        {' '}
        <span className="font-mono">Ctrl/⌘ + Space</span>
        {' '}
        唤出字段候选。
        没有 require / import / 网络 / 文件系统，超时会中断。
      </NodePanelHint>

      <NodePanelField label="脚本">
        <PanelCodeEditor
          language="javascript"
          fields={sourceFields}
          value={code}
          minHeight={160}
          maxHeight={360}
          placeholder={'// 例：把可用逻辑模型过滤一遍\nconst models = get(\'logicalModels[*].id\') || []\nreturn models.filter(id => !id.startsWith(\'test-\'))'}
          onChange={handleCodeChange}
        />
      </NodePanelField>

      {!code.trim() && <NodePanelHint tone="warning">脚本为空，运行时不会产出任何结果。</NodePanelHint>}

      <NodePanelField label="结果写回路径">
        <Input
          value={resultPath}
          placeholder="route.scriptResult"
          onChange={event => patch({ resultPath: event.target.value })}
        />
        {resultFields.length > 0 && (
          <Select value={resultPath || undefined} onValueChange={value => patch({ resultPath: value })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="从上游 schema 选择" /></SelectTrigger>
            <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
              {resultFields.map(field => (
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                  {field.path} · {field.valueType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </NodePanelField>

      {!resultPath.trim() && <NodePanelHint tone="warning">未配置结果写回路径，脚本结果会被丢弃。</NodePanelHint>}

      <NodePanelField label="超时（毫秒）">
        <Input
          type="number"
          min={1}
          max={SCRIPT_TIMEOUT_LIMIT}
          value={String(timeoutMilliseconds)}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10)
            patch({ timeoutMilliseconds: Number.isFinite(next) && next > 0 ? Math.min(next, SCRIPT_TIMEOUT_LIMIT) : 1 })
          }}
        />
      </NodePanelField>
    </div>
  )
}
