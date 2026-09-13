import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../toolkit/scripts/lib/log.mjs'
import { run } from '../../toolkit/scripts/lib/run.mjs'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const usage = `
Usage: pnpm db <command>

Commands:
  generate   Generate a new migration from schema changes
  migrate    Apply pending migrations
  studio     Open Drizzle Studio
`

const main = async () => {
  const [command, ...extraArguments] = process.argv.slice(2)

  const commands = {
    generate: ['drizzle-kit', 'generate'],
    migrate: ['drizzle-kit', 'migrate'],
    studio: ['drizzle-kit', 'studio'],
  }

  if (!commands[command]) {
    log.error(`Unknown command "${command}"`)
    console.log(usage)
    process.exit(1)
  }

  log.title(`DB — ${command}`)
  try {
    // 必须在包目录里跑：drizzle-kit 找的是相对 cwd 的 `drizzle.config.ts`。
    await run('pnpm', ['exec', ...commands[command], ...extraArguments], { cwd: packageDirectory })
    log.success(`Done: ${command}`)
  } catch (error) {
    log.error(`DB command failed: ${command}`)
    process.exit(1)
  }
}

main()
