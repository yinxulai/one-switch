import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import tailwindcss from '@tailwindcss/vite'

const previewOnly = process.env.VITE_PREVIEW_ONLY === 'true'
const projectRoot = fileURLToPath(new URL('./', import.meta.url))
// 渲染层需要应用版本号（例如内置「修改 UA」模板的默认值），但 `app.getVersion()` 只在主进程里有。
// 打包产物与 package.json 同版本（electron-builder 就用这个字段），所以构建时读一次注入即可；
// 声明在 `source/render/source/vite-env.d.ts`，测试侧同步见 `vitest.config.ts`。
const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

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
