/**
 * 核心服务进程的构建入口（产出 `output/command/service-main.mjs`）。
 *
 * 这层空壳是有用的：入口的**归属**在应用这边（`apps/app`），所以以后要在服务进程里
 * 塞应用级的东西（提前设 `process.env`、接应用自己的诊断钩子）不必去动 `packages/core`。
 * 真正的启动逻辑在 `@server/host/service-runtime`。
 */
import '@server/host/service-main'
