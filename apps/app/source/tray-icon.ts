import { app, nativeImage, type NativeImage } from 'electron'
// 托盘图标是离线生成的「全白蒙版」（见 `apps/app/build/tray-icon*.png`），
// Vite 会把它们内联成 data URL，运行时不需要解析磁盘路径。
import productionTrayIconUrl from '../build/tray-icon.png?url'
import productionTrayIcon2xUrl from '../build/tray-icon@2x.png?url'
import productionTrayIcon3xUrl from '../build/tray-icon@3x.png?url'
import productionTrayIconWinUrl from '../build/tray-icon-win.png?url'
import developmentTrayIconUrl from '../build/tray-icon-dev.png?url'
import developmentTrayIcon2xUrl from '../build/tray-icon-dev@2x.png?url'
import developmentTrayIcon3xUrl from '../build/tray-icon-dev@3x.png?url'
import developmentTrayIconWinUrl from '../build/tray-icon-dev-win.png?url'

interface TrayIconSources {
  /** Windows 专用：单张 48² 大图，直接当 1× 交给系统去缩。 */
  windows: string
  /** macOS / Linux：16² / 32² / 48² 三档，按显示倍率挑选。 */
  scaled: [string, string, string]
}

// 同时开着开发版和正式版时，开发版右下角多一颗圆点，一眼能分清。
// 圆点只加在托盘蒙版上，主图标与标志本身不受影响。
const trayIcons: TrayIconSources = app.isPackaged
  ? {
      windows: productionTrayIconWinUrl,
      scaled: [productionTrayIconUrl, productionTrayIcon2xUrl, productionTrayIcon3xUrl],
    }
  : {
      windows: developmentTrayIconWinUrl,
      scaled: [developmentTrayIconUrl, developmentTrayIcon2xUrl, developmentTrayIcon3xUrl],
    }

function loadPng(url: string): NativeImage {
  const image = nativeImage.createFromDataURL(url)
  if (image.isEmpty()) throw new Error('Unable to load the bundled tray icon')
  return image
}

/**
 * Windows 这条路和多倍率完全无关，必须单独喂一张大图。
 *
 * Electron 在 `Tray::SetImage` 里对 Windows 调用的是
 * `NativeImage::GetHICON(GetSystemMetrics(SM_CXSMICON))`；而非 .ico 来源的
 * `GetHICON` **把 size 参数丢掉了**，直接
 * `IconUtil::CreateHICONFromSkBitmap(image().AsBitmap())`——`AsBitmap()` 取的是
 * 1× 那一档。也就是说这里 `addRepresentation` 挂的 2×/3× 在 Windows 上根本读不到，
 * 系统只会得到一个 16² 的 HICON，再放大到 24/32px，于是糊。
 * 解法就是让 1× 本身足够大：给它 48²，HICON 自带像素，由系统自己缩小。
 */
function buildWindowsIcon(url: string): NativeImage {
  return loadPng(url)
}

/**
 * macOS / Linux 走真正的多倍率：macOS 通过 `native_image->image()` 拿到 ImageSkia
 * 后由系统按屏幕倍率取图，Linux 则取倍率最高的那一档。
 */
function buildScaledIcon(urls: [string, string, string]): NativeImage {
  const [base, ...retina] = urls
  const image = loadPng(base)
  retina.forEach((url, index) => {
    image.addRepresentation({ scaleFactor: index + 2, dataURL: url })
  })
  return image
}

/**
 * 所有平台、所有状态共用同一张全白图标。
 *
 * 颜色不作为状态通道：macOS 的 template image 由系统接管着色，我们给的彩色根本不会被采用；
 * Windows/Linux 的任务栏底色随系统主题变化，彩色图标在浅色底上反而糊成一团。
 * 状态由菜单第一行与 tooltip 表达——那里能写清楚端口号，比一个色点准确得多。
 *
 * **不要**再在代码里 `resize()`：它只会把某一个倍率重新取样一次，恰好就是这次要避免的糊。
 */
export function generateTrayIcon(): NativeImage {
  if (process.platform === 'win32') return buildWindowsIcon(trayIcons.windows)

  const icon = buildScaledIcon(trayIcons.scaled)
  // macOS 走 template image：由系统按菜单栏明暗自动着色——纯白图标在浅色菜单栏上会看不见。
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  return icon
}
