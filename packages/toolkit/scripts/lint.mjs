import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './lib/log.mjs'
import { run } from './lib/run.mjs'

// 一条命令跑完全部静态检查。检查项本身各有归属（ESLint 配置在根、代理分层在 core），
// 所以这里只做编排，不关心它们各自住在哪里；工作目录钉死在仓库根，
// 不依赖调用方从哪里执行。
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const main = async () => {
  log.title('Linting')
  try {
    await run('pnpm', ['exec', 'eslint', '.'], { cwd: repositoryRoot })
    // 用 process.execPath 而不是 'node'：Windows 上 run() 会给裸命令补 .cmd，`node.cmd` 并不存在。
    // 代理分层规则属于 core（改代理的人必须能自己跑它），所以脚本放在那个包里。
    await run(process.execPath, ['packages/core/scripts/check-proxy-layers.mjs'], { cwd: repositoryRoot })
    await run(process.execPath, ['packages/toolkit/scripts/check-package-boundaries.mjs'], { cwd: repositoryRoot })
    log.success('Lint passed')
  } catch (error) {
    log.error('Lint failed')
    process.exit(1)
  }
}

main()
