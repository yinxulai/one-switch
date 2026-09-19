// 下载清单：站内「直接下载」路由的单一事实来源。
//
// 安装包文件由 release 工作流生成（命名见 `apps/app/electron-builder.config.cjs` 的
// `artifactName`，形如 `OSW-<version>-<os>-<arch>.<ext>`），并上传到 R2 桶
// （默认 `osw-downloads`）。这里把「平台 → 桶内对象路径」钉死，Worker 与
// 前端下载按钮共用同一份映射，避免两处各写一遍导致对不上。
//
// ⚠️ R2 对象路径用的是仓库根 `package.json` 的 `version`（发布时由
// `packages/toolkit/scripts/version.mjs` 统一写入）。每次发版后 R2 桶里必须
// 有一个与当前版本号匹配的目录，否则下载会 404。

export interface DownloadItem {
  id: PlatformId
  /** R2 桶内对象路径（`${version}/${fileName}`）。 */
  key: string
}

export type PlatformId = 'mac' | 'win' | 'linux'

// 由 `vite.config.ts` 的 `define` 注入（见 `vite-env.d.ts`），来源为仓库根 `package.json` 的 `version`。
export const DOWNLOAD_VERSION = __APP_VERSION__

/** 站点只给每个平台提供一份（最新版本）安装包。 */
export function downloads(): DownloadItem[] {
  const v = DOWNLOAD_VERSION
  return [
    { id: 'mac', key: `${v}/OSW-${v}-mac-arm64.dmg` },
    { id: 'win', key: `${v}/OSW-${v}-win-x64.exe` },
    { id: 'linux', key: `${v}/OSW-${v}-linux-x86_64.AppImage` },
  ]
}
