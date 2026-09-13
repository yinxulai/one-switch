import { INPUT_NODE_FIELDS } from '../input-shape'
import type { NodePanelProps } from '../node-data'
import { useTranslation } from '@/i18n/provider'
import { NodePanelGroupHeader } from './panel-fields'

/**
 * 输入节点面板。
 *
 * 节点本身没有任何配置项（请求行、请求头、请求体都是调用方给出的事实），所以这里只把
 * 「这个节点会交出什么」摆出来：每条字段的路径与静态类型，有说明的再附一句。
 * 清单的唯一来源是 `../input-shape.ts`，与下游条件节点的字段候选表同源，
 * 因此面板里列出的就是下游真正能选的 —— 请求体里的字段不在其中，
 * 体里有什么由协议决定，那是协议发现节点的事。
 *
 * 「输入节点没有可配置项」这句话由外壳那条提示条统一讲（`nodePanelHint`），
 * 面板里不再抄一遍：两张一样的说明条叠在一起，读的人只会以为自己眼花了。
 * 参考表也不套灰底，靠一层边框 + `divide-y` 分开就够了。
 */
export function InputPanel(_props: NodePanelProps) {
  const t = useTranslation()

  return (
    <div className="grid gap-2.5">
      <div className="grid gap-2 rounded-lg border border-module-border p-2.5">
        <NodePanelGroupHeader title={t('router.panel.inputShapeTitle')} />
        <div className="divide-y divide-border/50">
          {INPUT_NODE_FIELDS.map(field => (
            <div key={field.path} className="grid gap-1 py-2 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono system-2xs-regular text-text-secondary">{field.path}</span>
                <span className="shrink-0 system-2xs-regular text-text-quaternary">{field.valueType}</span>
              </div>
              {field.noteKey
                ? <span className="system-xs-regular text-text-tertiary">{t(field.noteKey)}</span>
                : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
