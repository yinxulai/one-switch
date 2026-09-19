// 支持的平台清单：下载区那一行平台标记的唯一事实来源。
//
// 站点这一版**不做**按平台分发：一个公共按钮跳最新 release 页，用户在那里自己挑安装包。
// 所以这里只需要「有哪些平台、各叫什么」；识别文件名、挑架构那类规则等真的要做站内
// 分发时再加回来。

export type PlatformId = 'mac' | 'win' | 'linux'

export interface Platform {
  id: PlatformId
  /** 人类可读的平台名。 */
  label: string
}

export const PLATFORMS: Platform[] = [
  { id: 'mac', label: 'macOS' },
  { id: 'win', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
]
