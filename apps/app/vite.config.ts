import { defineConfig } from 'vite'
import { alias, mainEntry, nodeBuild, nodeDefine, nodeExternals } from './vite.shared.js'

// 主进程。预加载脚本是另一份配置（`vite.preload.config.ts`）：Vite 的配置文件只接受
// 「一个对象」，而两者输出格式不同（主进程 ESM，preload CJS），必须分开跑。
export default defineConfig({
  define: nodeDefine,
  resolve: { alias },
  build: {
    ...nodeBuild,
    rolldownOptions: {
      input: mainEntry,
      external: nodeExternals,
      // 必须显式声明跑在 Node 上：Rolldown 默认按浏览器处理，依赖里 `require('fs')` 这种
      // 外部引用不会自动接上 `createRequire`，而是在运行期抛
      // 「Calling require for "fs" in an environment that doesn't expose the require function」。
      // 它只管解析条件与 CJS 互操作，**不负责外部化**——内置模块仍要在 `external` 里显式列出
      // （见 `vite.shared.ts`）。这个值也不会让依赖变成外部依赖：产物依旧是自包含的
      // （`electron-builder.config.cjs` 只打包 `output`）。
      platform: 'node',
      // 入口文件名必须固定。Electron 是用 `package.json#main`（`output/command/index.js`）
      // 精确寻址这个文件的，默认的 `assets/index-<hash>.js` 会让应用直接启动失败。
      // 分包保持平铺，与 `output/command` 里其他产物同级，方便按目录整体搬走。
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
      },
    },
  },
})
