/// <reference types="vite/client" />

// 构建期注入的版本号，来源见 `vite.config.ts` 的 `define`（仓库根 `package.json` 的 `version`）。
declare const __APP_VERSION__: string
