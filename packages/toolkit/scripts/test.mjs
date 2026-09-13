import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './lib/log.mjs'
import { run } from './lib/run.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const main = async () => {
  const args = process.argv.slice(2)
  const coverage = args.includes('--coverage')
  log.title(coverage ? 'Running server tests with coverage' : 'Running server tests')
  try {
    // 跑在 Electron 带的 Node 里：`node:sqlite`（DatabaseSync）要求宿主 Node 版本与 ABI
    // 跟应用一致，系统 Node 上跑会直接报模块不可用。
    await run(
      'pnpm',
      ['exec', 'electron', 'node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts', ...args],
      {
        cwd: repositoryRoot,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    )
    log.success('All tests passed')
  } catch (error) {
    log.error('Tests failed')
    process.exit(1)
  }
}

main()
