import { run } from './lib/run.mjs'
import { log } from './lib/log.mjs'

const main = async () => {
  log.title('Linting')
  try {
    await run('pnpm', ['exec', 'eslint', '.'])
    // 用 process.execPath 而不是 'node'：Windows 上 run() 会给裸命令补 .cmd，`node.cmd` 并不存在。
    await run(process.execPath, ['scripts/check-proxy-layers.mjs'])
    log.success('Lint passed')
  } catch (error) {
    log.error('Lint failed')
    process.exit(1)
  }
}

main()
