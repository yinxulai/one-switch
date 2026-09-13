import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import packageJson from '../../package.json' with { type: 'json' }

// 渲染层需要应用版本号（内置「修改 UA」模板的默认值）。主进程有 `app.getVersion()`，
// 渲染层只能异步走 updater IPC 拿 `currentVersion`，而 `dev:preview` 与单测里根本没有 Electron，
// 所以版本号在构建期取一次、`define` 成字面量注入。
//
// 取的是**仓库根**的 `package.json`：那是唯一的发布版本权威（`apps/app/scripts/version.mjs` 负责把
// 同一个版本号写进全部 workspace manifest）。声明见 `source/vite-env.d.ts`，
// 测试侧的同一份注入见仓库根的 `vitest.config.ts`。
const appVersion = packageJson.version

// 渲染层是纯静态产物：不导入 `@server/*`，也不认识 `electron`。
// 目录职责见 product/packaging.md。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./source', import.meta.url)),
      '@common': fileURLToPath(new URL('../contracts/source', import.meta.url)),
      '@render': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  // 生产环境由 Electron 用 `loadFile` 以 `file://` 加载，`location.origin` 是 `null`。
  // 绝对路径（默认的 `/assets/...`）在这里会解析到盘根，所以资源引用必须是相对路径。
  base: './',
  server: {
    // 端口固定：`apps/app` 的开发脚本按这个地址拼 `VITE_DEV_SERVER_URL` 交给 Electron。
    // 端口漂移时 Electron 只会加载到空白页而不会报错，所以宁可让 Vite 直接失败。
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
