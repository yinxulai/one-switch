import { builtinModules } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import type { UserConfig } from 'vite'

// 主进程与 preload 是两个独立构建（输出格式不同），但共享同样的入口约定与别名。
// 这些常量放在这里，免得两份配置各写一遍、然后慢慢长歪。

export const mainEntry = fileURLToPath(new URL('./source/index.ts', import.meta.url))
export const preloadEntry = fileURLToPath(new URL('./source/preload.ts', import.meta.url))

// 输出目录名不是随意的。打包后这一段落在 asar 的 `dist/command`，而主进程代码用
// `__dirname` 反推两个位置：
//   `__dirname/..`    → `dist`，渲染层静态产物所在处（`loadFile(dist/render/index.html)`）
//   `__dirname/../..` → 应用根，`packages/core/drizzle` 迁移基线的探测起点
// 这两条都是运行期路径，typecheck / lint / 单测都看不见它们。改名必须同步改
// `electron-builder.config.cjs` 里的映射与 `packages/core/source/database/index.ts` 的候选列表。
export const outputDirectory = fileURLToPath(new URL('./dist/command', import.meta.url))

// 宿主只认识自己与两个内部包；渲染层不在这里构建（见 `packages/console/vite.config.ts`）。
// 注意这里要退两层：别名是相对 `apps/app/` 而不是相对仓库根。
export const alias = {
  '@common': fileURLToPath(new URL('../../packages/contracts/source', import.meta.url)),
  '@server': fileURLToPath(new URL('../../packages/core/source', import.meta.url)),
}

// 两次构建共用同一个输出目录，所以两边都不能让 Vite 清空它：任何一次 `emptyOutDir`
// 都会抹掉另一边的产物（`--watch` 下尤其明显——改主进程会把 preload.js 删掉而不会重建）。
// 清空由 `scripts/build.mjs` 在构建前统一做一次。
//
// `assetsInlineLimit: Infinity`：图标必须编成 data URL。托盘图标是用
// `nativeImage.createFromDataURL()` 消费导入值的，拿到相对文件路径会直接报错；
// 主进程产物里也不该出现需要单独寻址的资源文件。
export const sharedBuild = {
  outDir: outputDirectory,
  emptyOutDir: false,
  assetsInlineLimit: Infinity,
} satisfies UserConfig['build']

// 宿主进程跑在 Node 里，不是浏览器里——但 Vite 默认按浏览器解包依赖。少了这一步，
// `node:url`、`node:fs` 这些内置模块会被替换成一个「浏览器兼容性占位」空模块，
// 构建期只留一句警告，运行期才炸成 `(0, v.fileURLToPath) is not a function`，
// 而且报错点离真正的原因（构建配置）很远。
// 用 `vite-plugin-electron` 时这些外部化是插件悄悄加的；现在配置归我们自己写，
// 就得自己声明。`node:` 前缀的写法要单独补一份，`builtinModules` 只给裸名。
export const nodeExternals = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]

// 对齐 Electron 37 自带的 Node（22.x）。目标是让产物里的语法与内置模块按 Node 解析，
// 而不是按浏览器的 baseline 目标降级。
export const nodeTarget = 'node22'

// Vite 的默认构建环境叫 `client`，它会把 `process.env` 整体静态替换成 `{}`（浏览器语义），
// 于是 `process.env.VITE_DEV_SERVER_URL` 变成 `{}.VITE_DEV_SERVER_URL`——恒为 undefined。
// 主进程恰好靠它区分开发态与打包态（`apps/app/source/index.ts`），被替换掉就会静默按
// 生产端口启动、也不去加载 dev server，且没有任何警告。这里在顶层 `define` 把它改写成
// `globalThis.process.env`：既保留运行期真实的 env 读取，也不会自引用。
// 注意 `define` 是 Vite 的顶层选项，放进 `build` 里会被忽略。
export const nodeDefine = {
  'process.env': 'globalThis.process.env',
}

export const nodeBuild = {
  ...sharedBuild,
  target: nodeTarget,
} satisfies UserConfig['build']
