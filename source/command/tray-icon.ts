import { app, nativeImage, type NativeImage } from 'electron'
// 托盘图标是离线生成的「全白蒙版」（`scripts/generate-tray-icons.cjs`），
// Vite 会把 build/ 下的图片内联成 data URL，运行时不需要解析磁盘路径。
import productionTrayIconUrl from '../../build/tray-icon.png?url'
import developmentTrayIconUrl from '../../build/tray-icon-dev.png?url'

export type TrayIconStatus = 'running' | 'stopped' | 'error'

const TRAY_ICON_SIZE = 16
// macOS 走 template image：由系统按菜单栏明暗自动着色——纯白图标在浅色菜单栏上会看不见。
// 同时开着开发版和正式版时，开发版少一块图形，一眼能分清。
const trayIconUrl = app.isPackaged ? productionTrayIconUrl : developmentTrayIconUrl

/** 三个运行状态共用一张全白图标，状态差异由托盘菜单与 tooltip 表达。 */
export function generateTrayIcon(): NativeImage {
  const source = nativeImage.createFromDataURL(trayIconUrl)
  if (source.isEmpty()) throw new Error('Unable to load the bundled tray icon')

  const icon = source.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE, quality: 'best' })
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  return icon
}
