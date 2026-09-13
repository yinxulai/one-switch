import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './lib/log.mjs'
import { run } from './lib/run.mjs'

// 一次覆盖全部包：`tsconfig.check.json` 把四棵 source 树与构建配置放在同一个程序里。
// 逐包做类型检查需要每个包自己声明 paths，收益不大，反而多出四个会腐烂的配置。
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const main = async () => {
  log.title('Type checking')
  try {
    await run('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'tsconfig.check.json'], { cwd: repositoryRoot })
    log.success('Type check passed')
  } catch (error) {
    log.error('Type check failed')
    process.exit(1)
  }
}

main()
