import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../toolkit/scripts/lib/log.mjs'

// 代理引擎的分层约束校验。
//
// 分层规则写在文档里只有「共识」的价值，没有「约束」的价值：改代码时顺手 import 一个上层模块，
// 编译和测试都不会报错，直到某天想换掉一个传输或一个协议才发现拆不开。
// 这里用静态 import 检查把规则变成可执行的：新增文件自动纳入，不需要维护白名单。
//
// 用静态检查而不是 ESLint 规则，是为了避免与 `peculiar/*` 规则的解析/配置纠缠——
// 这里需要的是「按目录分层的禁止清单」这种 ESLint 表达不出来的语义。

// 脚本住在 `packages/core/scripts`，所以要往上退三层才是仓库根。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const proxyRoot = path.join(root, 'packages/core/source/proxy')

/** 每条规定一层目录下「禁止 import 什么」。 */
const RULES = [
  {
    layer: 'contracts',
    summary: '契约层只描述形状，不依赖任何实现',
    forbidden: [
      { pattern: /^@server\/proxy\/(?!contracts(\/|$))/, why: '契约层不得依赖 proxy 内部实现' },
      { pattern: /^@server\/(?!proxy\/)/, why: '契约层不得依赖 server 其他模块' },
    ],
  },
  {
    layer: 'kernel',
    summary: '搬运内核不知道协议、传输与数据库',
    forbidden: [
      { pattern: /^node:https?$/, why: '内核不得直接依赖 HTTP 模块（传输层负责出网）' },
      { pattern: /^@server\/proxy\/protocols/, why: '内核不得依赖协议实现' },
      { pattern: /^@server\/database/, why: '内核不得依赖数据库' },
    ],
  },
  {
    layer: 'transports',
    summary: '传输层只负责搬运字节，不参与观察、修改与候选决策',
    forbidden: [
      { pattern: /^@server\/proxy\/observability/, why: '传输层不得依赖观测实现' },
      { pattern: /^@server\/proxy\/modifiers/, why: '传输层不得依赖修改器' },
      { pattern: /^@server\/proxy\/planners/, why: '传输层不得依赖候选规划器' },
    ],
  },
  {
    layer: 'protocols',
    summary: '协议层描述报文，不参与搬运循环',
    forbidden: [
      { pattern: /^@server\/proxy\/kernel/, why: '协议层不得依赖搬运内核' },
      { pattern: /^@server\/database/, why: '协议层不得依赖数据库' },
    ],
  },
  {
    layer: 'planners',
    summary: '规划器只输出「连到哪里」，不搬运字节也不读观测结果',
    forbidden: [
      { pattern: /^@server\/proxy\/(transports|observability|modifiers|kernel|protocols|adapters|execution|request|response)/, why: '规划是决策，不得依赖执行与搬运实现' },
      { pattern: /^@server\/management/, why: '规划器不得依赖管理端' },
    ],
  },
]

/** 所有 `from '...'` / `import('...')` / `require('...')` 的模块说明符。 */
const IMPORT_PATTERN = /(?:from|import\(|require\()\s*'([^']+)'/g

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(target)))
      continue
    }
    // 测试文件为了搭夹具可以 import 任意模块，分层约束只作用于源码。
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(target)
    }
  }
  return files
}

function readSpecifiers(source) {
  const specifiers = []
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    specifiers.push(match[1])
  }
  return specifiers
}

/**
 * 把相对导入规范化成 tsconfig 里的绝对别名，否则规则只看 `@server/...` 的写法，
 * 一个 `../planners/x` 就能绕开全部约束。解析不了的一律保留原样（不猜）。
 */
function canonicalize(specifier, file) {
  if (!specifier.startsWith('.')) return specifier
  const resolved = path.resolve(path.dirname(file), specifier).replaceAll(path.sep, '/')
  const serverRoot = `${root.replaceAll(path.sep, '/')}/packages/core/source/`
  const commonRoot = `${root.replaceAll(path.sep, '/')}/packages/contracts/source/`
  if (resolved.startsWith(serverRoot)) return `@server/${resolved.slice(serverRoot.length)}`
  if (resolved.startsWith(commonRoot)) return `@common/${resolved.slice(commonRoot.length)}`
  return specifier
}

async function main() {
  log.title('Proxy layer check')

  const violations = []
  let checked = 0

  for (const rule of RULES) {
    const directory = path.join(proxyRoot, rule.layer)
    let files = []
    try {
      files = await collectSourceFiles(directory)
    } catch {
      // 图层不存在不算违规：分层约束描述的是「存在时不允许怎样」。
      continue
    }
    for (const file of files) {
      checked += 1
      const relative = path.relative(root, file).replaceAll(path.sep, '/')
      for (const raw of readSpecifiers(await readFile(file, 'utf8'))) {
        const specifier = canonicalize(raw, file)
        const hit = rule.forbidden.find(item => item.pattern.test(specifier))
        if (hit) {
          violations.push(`packages/core/source/proxy/${rule.layer} 层：${relative} → ${specifier}（${hit.why}）`)
        }
      }
    }
    log.info(`${rule.layer}: ${rule.summary}`)
  }

  if (violations.length > 0) {
    log.error(`Proxy layer check failed（${violations.length} 处越界）`)
    for (const violation of violations) {
      console.log(`  ${violation}`)
    }
    process.exit(1)
  }

  log.success(`Proxy layers respected（${checked} files）`)
}

main()
