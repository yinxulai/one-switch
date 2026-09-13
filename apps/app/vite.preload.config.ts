import { defineConfig } from 'vite'
import { alias, nodeBuild, nodeDefine, nodeExternals, preloadEntry } from './vite.shared.js'

// preload。与主进程分开跑，因为输出格式必须是 CommonJS：仓库 package.json 是
// `"type": "module"`，不显式指名 cjs 的话产物会被当 ESM 解析。
export default defineConfig({
  define: nodeDefine,
  resolve: { alias },
  build: {
    ...nodeBuild,
    lib: {
      entry: preloadEntry,
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rolldownOptions: {
      external: nodeExternals,
    },
  },
})
