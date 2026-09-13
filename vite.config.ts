import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import tailwindcss from '@tailwindcss/vite'
import packageJson from './package.json' with { type: 'json' }

const previewOnly = process.env.VITE_PREVIEW_ONLY === 'true'
const projectRoot = fileURLToPath(new URL('./', import.meta.url))
// 渲染层需要应用版本号（内置「修改 UA」模板的默认值）。主进程有 `app.getVersion()`，
// 渲染层只能异步走 updater IPC 拿 `currentVersion`，而 `dev:preview` 与单测里根本没有 Electron，
// 所以版本号在构建期从 package.json 取一次，`define` 成字面量注入。
// 声明在 `source/render/source/vite-env.d.ts`，测试侧同一份见 `vitest.config.ts`。
const appVersion = packageJson.version

const commonAlias = {
  '@common': fileURLToPath(new URL('./source/common', import.meta.url)),
  '@server': fileURLToPath(new URL('./source/server', import.meta.url)),
}

const renderAlias = {
  '@': fileURLToPath(new URL('./source/render/source', import.meta.url)),
  '@common': fileURLToPath(new URL('./source/common', import.meta.url)),
  '@render': fileURLToPath(new URL('./source/render', import.meta.url)),
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(previewOnly
      ? []
      : [
          electron([
            // Main process
            {
              entry: fileURLToPath(new URL('./source/command/index.ts', import.meta.url)),
              vite: {
                build: {
                  outDir: fileURLToPath(new URL('./dist/command', import.meta.url)),
                  rolldownOptions: {
                    external: ['electron'],
                  },
                },
                resolve: { alias: commonAlias },
              },
              onstart(context) {
                const { startup } = context
                startup([projectRoot, '--no-sandbox'])
              },
            },
            // Preload
            {
              entry: fileURLToPath(new URL('./source/command/preload.ts', import.meta.url)),
              vite: {
                build: {
                  outDir: fileURLToPath(new URL('./dist/command', import.meta.url)),
                  // Electron preload 脚本必须是 CommonJS，不支持 ESM。
                  // 项目 package.json 是 "type": "module"，需显式指定 cjs 格式。
                  lib: {
                    entry: fileURLToPath(new URL('./source/command/preload.ts', import.meta.url)),
                    formats: ['cjs'],
                    fileName: () => 'preload.js',
                  },
                  rollupOptions: {
                    external: ['electron'],
                  },
                },
              },
              onstart(context) {
                const { reload } = context
                reload()
              },
            },
          ]),
        ]),
  ],
  resolve: { alias: renderAlias },
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  root: 'source/render',
  publicDir: fileURLToPath(new URL('./build', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist/render', import.meta.url)),
    emptyOutDir: true,
  },
})
