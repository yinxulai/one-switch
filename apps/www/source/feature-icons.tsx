import type { ReactNode } from 'react'

/** 功能卡片用的图标 id，与 `App.tsx` 里 `FEATURES` 的 `id` 对应。 */
export type FeatureId = 'gateway' | 'failover' | 'routing' | 'rewrite' | 'logs' | 'privacy'

/**
 * 每个图标只由若干条 1.5px 描边路径组成，颜色继承 `currentColor`，
 * 与站点「发丝线 + 明度阶梯」的取向一致（不用填充块、不用阴影）。
 */
const SHAPES: Record<FeatureId, ReactNode> = {
  // 中心节点 + 四向连线：一个地址收拢所有渠道。
  gateway: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v6M12 15.5v6M2.5 12h6M15.5 12h6" />
    </>
  ),
  // 一上一下两个反向箭头：请求自动改道。
  failover: (
    <>
      <path d="M4 9h14.5" />
      <path d="m15 5.5 3.5 3.5L15 12.5" />
      <path d="M20 15H5.5" />
      <path d="m9 11.5-3.5 3.5L9 18.5" />
    </>
  ),
  // 主干分叉到另一个节点：按条件分流。
  routing: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M6 8.5v2.5a6 6 0 0 0 6 6h3.5" />
    </>
  ),
  // 铅笔：改写请求/响应。
  rewrite: (
    <>
      <path d="M4.5 16 16 4.5a2.5 2.5 0 1 1 3.5 3.5L8 19.5l-4 1 .5-4.5Z" />
      <path d="m14.5 6 3.5 3.5" />
    </>
  ),
  // 文本行：逐条记录。
  logs: (
    <>
      <path d="M5 7h14M5 12h14M5 17h7" />
    </>
  ),
  // 盾牌加对勾：本地与加密。
  privacy: (
    <>
      <path d="M12 3 5 6v5.5c0 4.4 2.9 7.6 7 9.5 4.1-1.9 7-5.1 7-9.5V6l-7-3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
}

interface FeatureIconProps {
  id: FeatureId
  className?: string
}

export function FeatureIcon(params: FeatureIconProps) {
  const { id, className } = params
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {SHAPES[id]}
    </svg>
  )
}
