import tsParser from '@typescript-eslint/parser'
import peculiar from '@yinxulai/eslint-plugin-peculiar'
import i18n from './scripts/eslint-plugin-i18n.mjs'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'release/**',
      'coverage/**',
    ],
  },
  ...peculiar.configs['flat/strict'],
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    files: ['source/**/*.{ts,tsx}'],
    plugins: { i18n },
    rules: {
      'i18n/no-hardcoded-cjk': 'error',
    },
  },
  {
    // 目录文件本身就是文案存放处；测试里的中文是断言而不是界面文案。
    files: [
      'source/common/i18n/catalogs/**',
      'source/**/*.test.{ts,tsx}',
      'source/**/test-support.ts',
    ],
    rules: {
      'i18n/no-hardcoded-cjk': 'off',
    },
  },
  {
    // 预设 / 种子数据是「用户数据」：写入即成为用户自己的内容，界面原样展示、永不翻译
    // （见 product/i18n.md §4）。
    files: [
      'source/common/router/presets.ts',
      'source/render/source/pages/model-management/lib/provider-presets.ts',
      'source/server/database/development-seed.ts',
    ],
    rules: {
      'i18n/no-hardcoded-cjk': 'off',
    },
  },
  {
    // 路由引擎的 trace / 决策依据是运行记录（随请求落库），不是可切换的界面文案。
    files: ['source/common/router/engine.ts'],
    rules: {
      'i18n/no-hardcoded-cjk': 'off',
    },
  },
  {
    files: ['source/render/source/components/ui/**/*.{ts,tsx}'],
    rules: {
      'peculiar/func-param-destructuring': 'off',
      'peculiar/func-param-inline-object-type': 'off',
      'peculiar/func-signature-linebreak': 'off',
    },
  },
]
