import { app, BrowserWindow, Menu, nativeImage, ipcMain, dialog, session } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer, stopServer } from '@server/index'
import { installLogCapture } from '@server/management/infrastructure/log-buffer'
import { createDatabaseFileName } from '@common/database-file'
import { getRuntimeProfile } from '@common/runtime-profile'
import { ElectronSecretStore } from './secret-store'
import { TrayManager } from './tray-manager'
import { AutoLaunchManager } from './auto-launch'
import { UpdaterManager, type UpdateState } from './updater'
import { nativeTranslator, onNativeLocaleChanged, startNativeLanguageSync } from './i18n'
// Vite 将 build/icon.png 打包为 data URL，避免运行时路径解析问题。
// Windows 任务栏/窗口图标需要位图，PNG 可被 nativeImage 直接识别。
import windowIconPng from '../build/icon.png?url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// The built directory structure
//
// ├─┬ dist
// │ ├─┬ command
// │ │ ├── index.js        > Electron Main
// │ │ └── preload.js
// │ ├─┬ server
// │ │   ...
// │ └─┬ render
// │     ...

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const runtimeProfile = getRuntimeProfile(isDevelopment ? 'development' : 'production')
// 数据文件名带主版本号：换了不兼容的结构就换一个文件，旧库原样留在磁盘上，不需要写迁移。
const databaseFileName = createDatabaseFileName(app.getVersion())

process.env.DIST = path.join(__dirname, '..')

app.setPath('userData', path.join(app.getPath('appData'), runtimeProfile.userDataDirectoryName))

let win: BrowserWindow | null = null
let trayManager: TrayManager | null = null
let autoLaunchManager: AutoLaunchManager | null = null
let updaterManager: UpdaterManager | null = null
let fatalErrorShown = false

// Windows 任务栏图标依赖 AppUserModelID；必须在创建任何窗口前设置，
// 否则系统会把进程归到默认 Electron 应用，导致显示默认图标。
if (process.platform === 'win32') {
  app.setAppUserModelId('com.yinxulai.one-switch')
}

function broadcastUpdateState(state: UpdateState) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updater:state-changed', state)
  }
}

function registerUpdaterIpc() {
  const updater = new UpdaterManager()
  updater.subscribe(broadcastUpdateState)
  updaterManager = updater

  ipcMain.handle('updater:get-state', () => updater.getState())
  ipcMain.handle('updater:check', () => updater.checkForUpdates())
  ipcMain.handle('updater:download', () => updater.downloadUpdate())
  ipcMain.handle('updater:install', () => updater.installUpdate())
  ipcMain.handle('updater:open-releases', () => updater.openReleasesPage())
}

registerUpdaterIpc()

function reportFatalError(error: unknown, title = nativeTranslator()('native.error.fatalTitle')): void {
  if (fatalErrorShown) return
  fatalErrorShown = true

  const detail = formatError(error)
  console.error(`[one-switch] ${title}`, detail)

  const showDialog = () => {
    dialog.showErrorBox(title, `${detail}\n\n${nativeTranslator()('native.error.fatalDetail')}`)
  }

  if (app.isReady()) {
    showDialog()
    app.quit()
  } else {
    void app.whenReady().then(() => {
      showDialog()
      app.quit()
    })
  }
}

process.on('uncaughtException', error => {
  reportFatalError(error)
})

process.on('unhandledRejection', reason => {
  reportFatalError(reason)
})

function formatUptime(): string {
  const seconds = Math.floor(process.uptime())
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}

function showStartupError(error: unknown): void {
  if (fatalErrorShown) return
  fatalErrorShown = true

  const detail = formatError(error)
  console.error('[one-switch] startup failed', detail)

  // 启动阶段还没有可用的渲染窗口，必须使用原生对话框告知用户，
  // 否则 app.quit() 会让应用看起来像是“启动后直接关闭”。
  const t = nativeTranslator()
  dialog.showErrorBox(
    t('native.error.startupTitle'),
    `${t('native.error.startupDetail')}\n\n${detail}`,
  )
}

function logStartupBanner() {
  const versions = process.versions
  const platformMap: Record<string, string> = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
  }
  const archMap: Record<string, string> = {
    x64: 'x64 (64-bit)',
    ia32: 'ia32 (32-bit)',
    arm64: 'arm64 (64-bit)',
    arm: 'arm (32-bit)',
  }

  const lines = [
    '',
    '  ╔══════════════════════════════════════════════════╗',
    '  ║              One Switch is starting...           ║',
    '  ╚══════════════════════════════════════════════════╝',
    '',
    `  Application :  ${app.getName()} v${app.getVersion()}`,
    `  Environment :  ${runtimeProfile.environment}`,
    `  Electron    :  v${versions.electron}`,
    `  Node.js     :  ${versions.node}`,
    `  Chromium    :  ${versions.chrome}`,
    `  V8          :  ${versions.v8}`,
    `  Platform    :  ${platformMap[process.platform] ?? process.platform} (${archMap[process.arch] ?? process.arch})`,
    `  OS Release  :  ${os.type()} ${os.release()}`,
    `  Hostname    :  ${os.hostname()}`,
    `  CPU Cores   :  ${os.cpus().length} (${os.cpus()[0]?.model ?? 'unknown'})`,
    `  Memory      :  ${Math.round(os.totalmem() / 1024 / 1024)} MB total`,
    `  User Data   :  ${app.getPath('userData')}`,
    `  Data File   :  ${databaseFileName}`,
    `  Proxy Port  :  ${runtimeProfile.proxyPort}`,
    `  Admin Port  :  ${runtimeProfile.managementPort}`,
    `  PID         :  ${process.pid}`,
    `  Uptime      :  ${formatUptime()}`,
    '',
  ]

  console.log(lines.join('\n'))
}

function resolveWindowIcon() {
  // Vite 把 ?url 解析为 data URL，开发/打包后均可直接使用，
  // 避免生产环境下 build/ 目录未被复制到 dist 的路径问题。
  // Windows 任务栏/窗口图标接受 PNG；exe/安装包图标由 electron-builder 使用 icon.ico。
  return nativeImage.createFromDataURL(windowIconPng)
}

/**
 * 安装 macOS 应用菜单。
 *
 * 保留系统应用菜单，否则 Cmd+V / Cmd+Q 等原生快捷键会失效。
 * - Cmd+Q 退出应用（走 before-quit 清理流程）
 * - Cmd+W 关闭窗口（被 tray-manager 拦截为隐藏到菜单栏）
 * - Cmd+M 最小化、Cmd+H 隐藏、Cmd+R 刷新界面
 *
 * 子项都用 `role`，标签由 Electron 按系统语言给出；这里只翻顶层 label。
 * 语言变化时需要重新调用一次，菜单文案是构建期快照。
 */
function installApplicationMenu(): void {
  const t = nativeTranslator()
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: t('native.menu.edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: t('native.menu.view'),
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools', visible: isDevelopment },
      ],
    },
    {
      label: t('native.menu.window'),
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
  ]))
}

function createWindow() {
  win = new BrowserWindow({
    title: 'One Switch',
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 移除默认菜单栏
  win.setMenuBarVisibility(false)
  if (process.platform === 'darwin') {
    installApplicationMenu()
  }

  win.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
    const failed = nativeTranslator()('native.error.rendererLoadFailed', {
      code: errorCode,
      description: errorDescription,
    })
    showStartupError(new Error(failed))
    void stopServer().catch(stopError => {
      console.error('[one-switch] failed to stop server after renderer load failure', formatError(stopError))
    })
    app.quit()
  })

  if (isDevelopment) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL!).catch(error => {
      showStartupError(error)
      app.quit()
    })
    win.webContents.openDevTools()
  } else {
    void win.loadFile(path.join(process.env.DIST!, 'render', 'index.html')).catch(error => {
      showStartupError(error)
      app.quit()
    })
  }
}

app.whenReady().then(async () => {
  // 在输出任何启动日志前安装拦截，确保横幅等信息也能进入运行日志页面。
  // installLogCapture 是幂等的，startServer 内部的重复调用会自动跳过。
  installLogCapture()
  logStartupBanner()

  const userDataDir = app.getPath('userData')
  try {
    await startServer({
      dataDir: userDataDir,
      databaseFileName,
      secretStore: new ElectronSecretStore(path.join(userDataDir, 'secrets.json')),
      runtimeProfile,
      systemProxyResolver: targetUrl => session.defaultSession.resolveProxy(targetUrl),
    })
    console.info('[one-switch] server started successfully')
  } catch (error) {
    showStartupError(error)
    app.quit()
    return
  }

  // 托盘 / 应用菜单 / 原生对话框都在主进程，语言真相源仍是 settings.language；
  // 数据库还读不出来时退回 app.getLocale()。必须在服务端启动后同步。
  onNativeLocaleChanged(() => {
    if (process.platform === 'darwin') installApplicationMenu()
  })
  await startNativeLanguageSync()

  try {
    createWindow()
  } catch (error) {
    showStartupError(error)
    await stopServer().catch(stopError => {
      console.error('[one-switch] failed to stop server after startup failure', formatError(stopError))
    })
    app.quit()
    return
  }

  // 初始化系统托盘
  try {
    trayManager = new TrayManager()
    trayManager.init(win!)
  } catch (error) {
    trayManager = null
    console.error('[one-switch] failed to initialize tray', error)
  }

  // 开发环境不应修改系统登录项。
  if (runtimeProfile.environment === 'production') {
    autoLaunchManager = new AutoLaunchManager()
    void autoLaunchManager.init()
  } else {
    console.debug('[auto-launch] initialization skipped reason=development')
  }

  // 启动 10 秒后静默检查一次更新，避免阻塞启动。
  // 仅在生产环境执行，开发环境下版本号无意义。
  if (runtimeProfile.environment === 'production' && updaterManager) {
    setTimeout(() => {
      void updaterManager!.checkForUpdates()
    }, 10_000)
  }

  console.info(`[one-switch] ready startupDuration=${formatUptime()}`)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else if (trayManager) void trayManager.showWindow()
  })
})

app.on('window-all-closed', () => {
  // 不退出应用，保持在托盘运行
  // if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (trayManager) {
    trayManager.prepareForQuit()
  }
  void stopServer()
})
