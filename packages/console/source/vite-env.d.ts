/// <reference types="vite/client" />

/** 构建时由 Vite 注入（见 `vite.config.ts` 与 `packages/toolkit/vitest.config.ts` 的 `define`）：`package.json` 的 `version`。 */
declare const __APP_VERSION__: string

type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

interface ReleaseAsset {
  name: string
  size: number
  downloadUrl: string
}

interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseDate: string
  releaseUrl: string
  assets: ReleaseAsset[]
  preferredAsset?: ReleaseAsset
}

interface UpdateState {
  status: UpdateCheckStatus
  info: UpdateInfo | null
  errorMessage: string | null
  downloadProgress: number | null
  downloadedFile: string | null
}

/** `download()` 的结果，与主进程 `apps/app/source/updater.ts` 的 `UpdateDownloadResult` 一致。 */
type UpdateDownloadResult =
  | 'downloading'
  | 'download-complete'
  | 'manual-download'
  | 'failed'

interface UpdaterAPI {
  getState: () => Promise<UpdateState>
  check: () => Promise<UpdateState>
  download: () => Promise<UpdateDownloadResult>
  install: () => Promise<void>
  openReleases: () => Promise<void>
  onStateChanged: (callback: (state: UpdateState) => void) => () => void
}

interface ElectronAPI {
  platform: string
  /** 用系统默认方式打开外部链接。主进程只放行 `https:`。 */
  openExternal: (url: string) => void
  updater: UpdaterAPI
}

/**
 * 宿主注入的运行时信息（`window.__OSW__`）。
 *
 * 回答一个问题：控制台这份产物只有一份，它怎么找到管理服务？Electron 形态从 `file://`
 * 加载页面，靠 URL 推不出管理服务在哪儿，所以由 preload 注入 `apiBase`；浏览器形态
 * 是 `undefined`，控制台按页面来源自己算（见 `api/client.ts`）。
 */
interface OswRuntime {
  apiBase?: string
}

interface Window {
  /** 只有 Electron 形态（preload 注入）才有；浏览器形态是 `undefined` 。 */
  electronAPI?: ElectronAPI
  __OSW__?: OswRuntime
}
