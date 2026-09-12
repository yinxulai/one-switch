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
import { useTranslation } from '@/i18n/provider'
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
  const t = useTranslation()

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
        {t('router.panel.scriptHint.sandbox')}
        {' '}
        <span className="font-mono">payload</span>
        {t('router.panel.scriptHint.payloadSuffix')}
        <span className="font-mono">{t('router.panel.scriptHint.getValueExample')}</span>
        {t('router.panel.scriptHint.getSuffix')}
        <span className="font-mono">a[*].b</span>
        {t('router.panel.scriptHint.projectionSuffix')}
        <span className="font-mono">console</span>
        {t('router.panel.scriptHint.consoleSuffix')}
        {' '}
        <span className="font-mono">return</span>
        {' '}
        {t('router.panel.scriptHint.returnSuffix')}
        {' '}
        <span className="font-mono">{"get('"}</span>
        {' '}
        {t('router.panel.scriptHint.getCallSuffix')}
        {' '}
        <span className="font-mono">Ctrl/⌘ + Space</span>
        {' '}
        {t('router.panel.scriptHint.shortcutSuffix')}
      </NodePanelHint>

      <NodePanelField label={t('router.panel.script')}>
        <PanelCodeEditor
          language="javascript"
          fields={sourceFields}
          value={code}
          minHeight={160}
          maxHeight={360}
          placeholder={t('router.panel.scriptPlaceholder')}
          onChange={handleCodeChange}
        />
      </NodePanelField>

      {!code.trim() && <NodePanelHint tone="warning">{t('router.panel.warnEmptyScript')}</NodePanelHint>}

      <NodePanelField label={t('router.panel.resultPath')}>
        <Input
          value={resultPath}
          placeholder="route.scriptResult"
          onChange={event => patch({ resultPath: event.target.value })}
        />
        {resultFields.length > 0 && (
          <Select value={resultPath || undefined} onValueChange={value => patch({ resultPath: value })}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t('router.panel.selectFromSchema')} /></SelectTrigger>
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

      {!resultPath.trim() && <NodePanelHint tone="warning">{t('router.panel.warnNoResultPath')}</NodePanelHint>}

      <NodePanelField label={t('router.panel.timeoutMilliseconds')}>
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
