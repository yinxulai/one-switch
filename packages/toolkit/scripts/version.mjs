import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './lib/log.mjs'

// 版本号的唯一来源是仓库根的 `package.json`：`pnpm version:set <version>` 把它强制覆盖到
// 每一个 workspace 包，`pnpm version:check` 只读校验它们全都与它一致。
//
// 为什么需要它：版本号有三个消费方，而且都在构建期读取而不是运行期查询——
// ① 渲染层的 `__APP_VERSION__`（`packages/console/vite.config.ts` 读根 manifest）
// ② Electron 的 `app.getVersion()`（读 `apps/app/package.json`，electron-builder 也用它做产物名）
// ③ 命令行宿主的 `__CLI_VERSION__` 与 `osw version`（`apps/cli`）
// 三者不一致的后果不是报错而是「看起来正常但不对」：更新器的产物名会对不上，
// 界面上显示的版本也不是实际在跑的那个。所以只留一个入口。
//
// 数据文件名刻意不在这里：文件名带的是**数据库结构版本**（见
// `packages/contracts/source/database-file.ts`），由那个文件里的常量手动维护、只在应用大版本
// 发布时加一，所以它不是这个脚本该推的数字。若让每次发布都自动改它，一次补丁升级就会让用户的
// 配置在界面上凭空消失。
//
// 为什么住在 toolkit：它改的是每一个 workspace 包的 manifest，任何单一包都不是它的归属物；
// 而 toolkit 就是「跨包脚本」的落脚处（与 `lint.mjs` / `test.mjs` / `typecheck.mjs` 同级），
// 它原本就只差一个相对路径去用同目录的 `lib/log.mjs`。
//
// 为什么不写包目录清单：这里曾经手写一份，`release.yml` 里那行 `git add` 也手写一份，
// 两边都漏掉了后加的 `apps/cli`——于是 `1.1.0-beta.3` 发出去之后，仓库里的
// `apps/cli/package.json` 还停在 `1.1.0-beta.2`。产物是对的（CI 里这个脚本确实改了工作区里的
// 文件，只是那份改动没被提交），本地 typecheck / lint / test 一路全绿，看不出来。
// 现在包目录从 `pnpm-workspace.yaml` 现算：加包不需要改这里。
//
// `--check` 是给追这件事用的：它不写文件，只在有包与根不一致时报错。挂在 `pnpm lint` 里，
// 于是「哪一份 manifest 没被提交」会在下一次 CI 上变成红的，而不是等发布之后靠人回头看。

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const rootManifestPath = path.join(repositoryRoot, 'package.json')

function relativePath(manifestPath) {
  return path.relative(repositoryRoot, manifestPath).replaceAll(path.sep, '/')
}

// `pnpm-workspace.yaml` 里 `packages:` 那一节的条目。`dir/*` 展开成目录下的每个包，
// 其余写法按包目录原样使用；扩展不出来的条目会在读 manifest 时直接 ENOENT——
// 「清单少列了一个成员」正是这个脚本存在的理由，宁可炸也不能默默少列。
function workspaceDirectories() {
  const lines = fs.readFileSync(path.join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8').split('\n')
  const start = lines.findIndex(line => /^packages:\s*$/.test(line))
  if (start === -1) throw new Error('pnpm-workspace.yaml 里找不到 `packages:`')

  const patterns = []
  for (const line of lines.slice(start + 1)) {
    // 顶格的下一节（例如 `allowBuilds:`）表示列表结束。
    if (/^\S/.test(line)) break
    const entry = line.match(/^\s*-\s*(\S+)\s*$/)?.[1]
    if (entry !== undefined) patterns.push(entry)
  }

  return patterns.flatMap(pattern => {
    if (!pattern.endsWith('/*')) return [pattern]
    const parent = pattern.slice(0, -2)
    return fs.readdirSync(path.join(repositoryRoot, parent), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => `${parent}/${entry.name}`)
      .filter(directory => fs.existsSync(path.join(repositoryRoot, directory, 'package.json')))
      .sort()
  })
}

const manifestPaths = [
  rootManifestPath,
  ...workspaceDirectories().map(directory => path.join(repositoryRoot, directory, 'package.json')),
]

function readVersion(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version
}

function check() {
  const expected = readVersion(rootManifestPath)
  const drifted = manifestPaths
    .map(manifestPath => [relativePath(manifestPath), readVersion(manifestPath)])
    .filter(([, version]) => version !== expected)

  if (drifted.length > 0) {
    log.error(`Version drift: ${relativePath(rootManifestPath)} is ${expected}, but`)
    for (const [manifestPath, version] of drifted) log.error(`  ${manifestPath} is ${version}`)
    log.error('Run `pnpm version:set <version>` to overwrite every manifest with the root version.')
    process.exit(1)
  }

  log.success(`Version ${expected} in ${manifestPaths.length} manifests`)
}

function set(version) {
  log.title(`Setting version to ${version}`)
  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const previousVersion = manifest.version
    manifest.version = version
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    log.info(`${relativePath(manifestPath)}: ${previousVersion} → ${version}`)
  }

  log.success(`Version updated in ${manifestPaths.length} manifests`)
}

const version = process.argv[2]

// 与 `release.yml` 的 `Validate version` 保持同一个形状：那边收下的版本号这里也必须收下。
if (version === undefined) {
  log.error('Usage: pnpm version:set <version> | pnpm version:check')
  process.exit(1)
} else if (version === '--check') {
  check()
} else if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(version)) {
  log.error(`Not a valid semver version: ${version}`)
  process.exit(1)
} else {
  set(version)
}
