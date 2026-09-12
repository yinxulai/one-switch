import { useCallback, useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { NodePanelProps } from '../node-data'
import { PROMPT_TIMEOUT_LIMIT, type PromptNode } from '@common/router/types'
import {
  NodePanelField,
  NodePanelHint,
  PANEL_POPUP_ITEM_CLASSNAME,
  PANEL_POPUP_SURFACE_CLASSNAME,
} from './panel-fields'

/**
 * LLM 节点面板。
 *
 * 这里只选「用哪个逻辑模型 + 说什么」，真正的调用由服务端走真实上游通路执行
 * （密钥、协议转换、故障转移全部沿用请求链路），所以面板不提供任何连接配置项。
 */
export function PromptPanel(props: NodePanelProps) {
  const { model, logicalModels, conditionFieldHints, update } = props
  const node = model.kind === 'prompt' ? model : undefined
  const logicalModelId = node?.logicalModelId ?? ''
  const systemPrompt = node?.systemPrompt ?? ''
  const promptTemplate = node?.promptTemplate ?? ''
  const resultPath = node?.resultPath ?? ''
  const temperature = node?.temperature ?? 0.7
  const maxTokens = node?.maxTokens ?? 1_024
  const timeoutMilliseconds = node?.timeoutMilliseconds ?? 60_000
  // 插入变量是一次性动作，插入后必须把选择器清空，否则连续选同一字段不会再触发。
  const [insertedPath, setInsertedPath] = useState<string | undefined>(undefined)

  const patch = useCallback((patchValue: Partial<PromptNode>) => {
    update(current => current.kind === 'prompt' ? { ...current, ...patchValue } : current)
  }, [update])

  /** 提示词模板变量候选：数组 / 对象塞进提示词没有意义，只列标量字段。 */
  const templateFields = useMemo(
    () => conditionFieldHints.filter(field => field.valueType !== 'object' && field.valueType !== 'array'),
    [conditionFieldHints],
  )

  const selectedModel = useMemo(
    () => logicalModels.find(item => item.id === logicalModelId),
    [logicalModels, logicalModelId],
  )

  const appendTemplate = useCallback((path: string) => {
    update(current => current.kind === 'prompt'
      ? { ...current, promptTemplate: `${current.promptTemplate}\${${path}}` }
      : current)
  }, [update])

  if (!node) return null

  return (
    <div className="grid gap-2.5">
      <NodePanelHint>
        调用走的是真实请求链路：与本节点上游的协议探测结果保持一致，直接命中上游的密钥、协议转换与故障转移。
        提示词模板里
        {' '}
        <span className="font-mono">{'${路径}'}</span>
        {' '}
        会在执行前替换成本次运行的数据。
      </NodePanelHint>

      <NodePanelField label="逻辑模型">
        <Select value={logicalModelId || undefined} onValueChange={value => patch({ logicalModelId: value })}>
          <SelectTrigger className="w-full"><SelectValue placeholder="选择逻辑模型" /></SelectTrigger>
          <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
            {logicalModels.map(item => (
              <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={item.id} value={item.id}>
                {item.name} · {item.id}{item.enabled ? '' : ' · 已停用'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </NodePanelField>

      {!logicalModelId && <NodePanelHint tone="warning">尚未选择逻辑模型，运行时会跳过本节点并记录失败。</NodePanelHint>}
      {logicalModelId && !selectedModel && (
        <NodePanelHint tone="warning">逻辑模型 {logicalModelId} 已不存在，请在逻辑模型页确认。</NodePanelHint>
      )}
      {selectedModel && !selectedModel.enabled && (
        <NodePanelHint tone="warning">逻辑模型 {selectedModel.name} 已停用，运行时可能没有可用上游。</NodePanelHint>
      )}

      <NodePanelField label="系统提示词">
        <Textarea
          className="min-h-[64px] text-xs leading-5"
          value={systemPrompt}
          placeholder="可选，例如：你是一个严谨的接口路由助手。"
          onChange={event => patch({ systemPrompt: event.target.value })}
        />
      </NodePanelField>

      <NodePanelField label="提示词">
        <Textarea
          className="min-h-[120px] text-xs leading-5"
          value={promptTemplate}
          placeholder={'例如：请从 ${logicalModels[*].id} 里挑一个最合适的，只回答 id。'}
          onChange={event => patch({ promptTemplate: event.target.value })}
        />
        {templateFields.length > 0 && (
          <Select
            value={insertedPath}
            onValueChange={(value) => {
              appendTemplate(value)
              setInsertedPath(undefined)
            }}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="插入字段 ${路径}" /></SelectTrigger>
            <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
              {templateFields.map(field => (
                <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                  {field.path} · {field.valueType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </NodePanelField>

      {!promptTemplate.trim() && <NodePanelHint tone="warning">提示词为空，节点会直接发出一个空消息。</NodePanelHint>}

      <NodePanelField label="回复写回路径">
        <Select value={resultPath || undefined} onValueChange={value => patch({ resultPath: value })}>
          <SelectTrigger className="w-full"><SelectValue placeholder="从上游 schema 选择" /></SelectTrigger>
          <SelectContent className={PANEL_POPUP_SURFACE_CLASSNAME}>
            {conditionFieldHints.map(field => (
              <SelectItem className={PANEL_POPUP_ITEM_CLASSNAME} key={field.path} value={field.path}>
                {field.path} · {field.valueType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={resultPath}
          placeholder="route.promptResult"
          onChange={event => patch({ resultPath: event.target.value })}
        />
      </NodePanelField>

      {!resultPath.trim() && <NodePanelHint tone="warning">未配置写回路径，模型回复无法被下游节点读取。</NodePanelHint>}

      <NodePanelField label="温度">
        <Input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={String(temperature)}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value)
            patch({ temperature: Number.isFinite(next) ? Math.min(Math.max(next, 0), 2) : 0 })
          }}
        />
      </NodePanelField>

      <NodePanelField label="最大回复长度（token）">
        <Input
          type="number"
          min={1}
          value={String(maxTokens)}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10)
            patch({ maxTokens: Number.isFinite(next) && next > 0 ? next : 1 })
          }}
        />
      </NodePanelField>

      <NodePanelField label="超时（毫秒）">
        <Input
          type="number"
          min={1}
          max={PROMPT_TIMEOUT_LIMIT}
          value={String(timeoutMilliseconds)}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10)
            patch({ timeoutMilliseconds: Number.isFinite(next) && next > 0 ? Math.min(next, PROMPT_TIMEOUT_LIMIT) : 1 })
          }}
        />
      </NodePanelField>
    </div>
  )
}
