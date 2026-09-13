import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

// 与 `vite.config.ts` 的 `define` 保持一致：测试同样走 Vite 的转换管线，
// 少了这一行，任何间接 import 到 `rule-presets.ts` 的用例都会因 `__APP_VERSION__` 未定义而炸。
const appVersion = packageJson.version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  resolve: {
    alias: {
      '@common': fileURLToPath(new URL('./packages/contracts/source', import.meta.url)),
      '@server': fileURLToPath(new URL('./packages/core/source', import.meta.url)),
      '@render': fileURLToPath(new URL('./packages/console', import.meta.url)),
      '@': fileURLToPath(new URL('./packages/console/source', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./packages/console/scripts/vitest.setup.ts'],
    // 注意：必须同时覆盖 .ts 与 .tsx，否则组件测试（jsdom + Testing Library）
    // 会被静默跳过，套件仍显示全绿。
    include: [
      'apps/app/source/**/*.test.{ts,tsx}',
      'packages/core/source/**/*.test.{ts,tsx}',
      'packages/contracts/source/**/*.test.{ts,tsx}',
      'packages/console/source/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html'],
      reportsDirectory: './coverage',
      include: [
        'apps/app/source/updater.ts',
        'packages/core/source/**/*.ts',
        'packages/contracts/source/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/types.ts', '**/schemas.ts', '**/test-support.ts'],
    },
  },
})
