/**
 * 核心服务的**运行时**入口。它由 `apps/app/source/service.ts` 打包成
 * `output/command/service-main.mjs`（那个文件才是构建入口，归属在应用那边）。
 *
 * **只**能被宿主的 `utilityProcess.fork()` 加载，不要 import 它去拿别的东西：这里带着
 * 顶层 `await`，而且在非服务进程环境下直接抛异常。真正的逻辑在 `./service-runtime`。
 *
 * 与上一版（`worker_threads`）相比少了一条纪律：**`process.exit()` 现在是安全的**，
 * 它只结束这个进程，不会带走 Electron。但仍然不该主动调它——退出流程由宿主掌控
 * （先 `runtime.stop` 优雅收尾，再 `kill`），自己先走会把实例锁和数据库留在半截状态。
 */
import { startServiceRuntime } from './service-runtime'
import type { RpcPort } from './rpc'

/**
 * `process.parentPort` 只存在于 `utilityProcess` 里。
 *
 * 形状自己声明而不是从 `electron` 的类型定义里拿：`packages/core` 不依赖 Electron
 * （它还要被 `apps/cli` 复用），为一个接口把整个 Electron 类型拉进来不划算。
 * 形状取自 Electron 的 `ParentPort`：消息事件带一层 `{ data, ports }` 外皮，
 * `data` 才是真正的载荷，`ports` 是随消息转移过来的 `MessagePort`（这里用不到）。
 */
interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
if (parentPort === undefined) throw new Error('The core service must be started as an Electron utility process')

const port: RpcPort = {
  postMessage: message => parentPort.postMessage(message),
  on: (_event, listener) => parentPort.on('message', event => listener(event.data)),
}

await startServiceRuntime({ port })
