import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import packageJson from '../../package.json' with { type: 'json' }

// 站点构建期注入版本号（与渲染层同源，见 packages/console/vite.config.ts）：
// 下载清单用它拼 R2 对象路径，与 electron-builder 的产物命名对齐。
const appVersion = packageJson.version

// 站点是纯静态产物，不导入 `@server/*`，也不认识 `electron`。
// `base: '/'`：站点部署在自有域名根路径（非子路径），资源用绝对路径即可。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./source', import.meta.url)),
    },
  },
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'output',
    emptyOutDir: true,
  },
})
