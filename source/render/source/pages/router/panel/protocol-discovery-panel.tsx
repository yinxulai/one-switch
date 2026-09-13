import { ALL_WORKFLOW_PROTOCOLS } from '@common/router/types'
import { requestShapeOf } from '@common/router/request-shape'
import type { NodePanelProps } from '../node-data'
import { useTranslation } from '@/i18n/provider'
import { NodePanelGroupHeader } from './panel-fields'

/**
 * 协议发现节点面板。
 *
 * 节点本身没有任何配置项（协议由系统按路径与请求头认出），所以这里只把
 * 「这个节点会交出什么」摆出来：每种协议分支下列出它声明的请求体字段。
 * 声明表的唯一来源是 `@common/router/request-shape.ts`，与下游条件节点的候选表同源，
 * 因此面板里读到的就是下游真正能选的。
 *
 * 零配置节点面板里只有这一块只读参考表：节点定位由外壳那条提示条讲，
 * 分支出口在画布上看得见，再堆说明条只会让整屏都是灰盒子。
 */
export function ProtocolDiscoveryPanel(_props: NodePanelProps) {
  const t = useTranslation()

  return (
    <div className="grid gap-2.5">
      <div className="grid gap-2 rounded-lg border border-module-border p-2.5">
        <NodePanelGroupHeader title={t('router.panel.protocolShapeTitle')} />
        <div className="divide-y divide-border/50">
          {ALL_WORKFLOW_PROTOCOLS.map((protocol) => {
            const shape = requestShapeOf(protocol)

            return (
              <div key={protocol} className="grid gap-1 py-2 first:pt-0 last:pb-0">
                <span className="font-mono system-2xs-regular text-text-tertiary">{protocol}</span>
                {shape && shape.fields.length > 0
                  ? shape.fields.map(field => (
                      <div key={field.path} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-mono system-2xs-regular text-text-secondary">{field.path}</span>
                        <span className="shrink-0 system-2xs-regular text-text-quaternary">{field.valueType}</span>
                      </div>
                    ))
                  : <span className="system-2xs-regular text-text-quaternary">{t('router.panel.protocolShapeEmpty')}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
