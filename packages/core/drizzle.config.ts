import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'drizzle-kit'

// 配置住在 core 包里，所以路径相对它解析；`pnpm db:*` 会把 cwd 切到 `packages/core`
// （见 `packages/core/scripts/db.mjs`），drizzle-kit 才找得到这份配置。
export default defineConfig({
  dialect: 'sqlite',
  schema: fileURLToPath(new URL('./source/database/schema.ts', import.meta.url)),
  out: fileURLToPath(new URL('./drizzle', import.meta.url)),
})
