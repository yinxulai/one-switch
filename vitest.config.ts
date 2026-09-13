import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@common': fileURLToPath(new URL('./source/common', import.meta.url)),
      '@server': fileURLToPath(new URL('./source/server', import.meta.url)),
      '@render': fileURLToPath(new URL('./source/render', import.meta.url)),
      '@': fileURLToPath(new URL('./source/render/source', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // 注意：必须同时覆盖 .ts 与 .tsx，否则组件测试（jsdom + Testing Library）
    // 会被静默跳过，套件仍显示全绿。
    include: [
      'source/command/**/*.test.{ts,tsx}',
      'source/server/**/*.test.{ts,tsx}',
      'source/common/**/*.test.{ts,tsx}',
      'source/render/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json', 'html'],
      reportsDirectory: './coverage',
      include: [
        'source/command/updater.ts',
        'source/server/**/*.ts',
        'source/common/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/types.ts', '**/schemas.ts', '**/test-support.ts'],
    },
  },
})
