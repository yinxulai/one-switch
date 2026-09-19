// 平台清单：前端下载卡片与 Worker 下载路由共用的纯净配置（不含版本，不依赖 Vite 注入常量）。
//
// 安装包命名见 `apps/app/electron-builder.config.cjs` 的 `artifactName`：
// `OSW-<version>-<os>-<arch>.<ext>`。`match` 是文件名里识别平台用的子串，前端与 Worker
// 各按自己的方式消费（前端拼展示、Worker 列桶匹配最新对象）。

export interface Platform {
  id: 'mac' | 'win' | 'linux'
  /** 人类可读的平台名。 */
  label: string
  /** 文件名里用于识别该平台的子串（对 `-mac-` / `-win-` / `-linux-`）。 */
  match: string
}

export const PLATFORMS: Platform[] = [
  { id: 'mac', label: 'macOS', match: '-mac-' },
  { id: 'win', label: 'Windows', match: '-win-' },
  { id: 'linux', label: 'Linux', match: '-linux-' },
]
