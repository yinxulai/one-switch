import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'

// 从提交记录生成 GitHub Release 说明，取代手写的 `.github/release-body.md`。
//
// 为什么不再放一份 md：那个文件必须每次发布重写，而「这一版改了什么」的事实本来就写在
// 提交里，两份副本只会有一份腐烂——旧文件的内容停在 v1.0.0-rc.4，却被 v1.1.0-beta.1
// 原样发了出去，连「64 个测试文件、369 项测试」都是几个版本前的数字。
//
// 生成规则只依赖本仓的提交约定（`type(scope): 祈使句`）：按 type 分组，破坏性变更只认
// `!` 与 `BREAKING CHANGE:`。改提交约定就会改到这里，这是唯一需要共同维护的地方。
//
// 下载表格不硬编码平台清单：`${os}` / `${arch}` 从 electron-builder 的 `artifactName`
// 读出模板，再拿真实文件名去匹配。改打包配置后这里不需要跟着改，表格里出现的也永远是
// 真的被上传了的那几个文件。
//
// 用法（发布链里由 `publish` job 调用）：
//   node apps/app/scripts/release-notes.mjs --version 1.1.0-beta.1 --tag v1.1.0-beta.1 \
//     --assets-dir artifacts --output "$RUNNER_TEMP/release-notes.md"
//
// 补写已经发出去的版本时没有本地产物目录，就吃 GitHub 的资产清单，并把端点指到那个标签：
//   gh api repos/yinxulai/osw/releases/tags/v1.1.0-beta.1 \
//     --jq '[.assets[] | {name, size}]' > assets.json
//   pnpm release:notes --version 1.1.0-beta.1 --head v1.1.0-beta.1 --assets-json assets.json > notes.md
//
// 说明文字固定英文：提交主题按约定就是英文，硬凑中文只会得到「半句英文的说明」。
// 需要给某一版加一段人话，发布后在 GitHub 上编辑该 Release 即可，不必回到仓库。

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const fail = (message) => {
  log.error(message)
  process.exit(1)
}

/** 提交类型 → 说明里的分组。类型不在表里的归入最后一组。 */
const groups = [
  { title: 'New', types: ['feat'] },
  { title: 'Fixed', types: ['fix'] },
  { title: 'Performance', types: ['perf'] },
  { title: 'Changed', types: ['refactor', 'polish', 'style'] },
  { title: 'Under the hood', types: ['docs', 'chore', 'ci', 'build', 'test', 'revert'] },
]

const fallbackGroupTitle = 'Other changes'

/** 只进表格的安装包后缀；`.zip` / `.blockmap` / `latest*.yml` 是更新器的载荷，不给用户点。 */
const installerExtensions = ['.dmg', '.exe', '.appimage']

const platformLabels = { darwin: 'macOS', mac: 'macOS', win: 'Windows', windows: 'Windows', linux: 'Linux' }
const platformOrder = ['mac', 'win', 'linux']

const archLabels = {
  mac: { arm64: 'Apple silicon', x64: 'Intel' },
  win: { x64: 'x64', arm64: 'ARM64', ia32: '32-bit' },
  linux: { x64: 'x64', x86_64: 'x64', arm64: 'ARM64' },
}

// ---------------------------------------------------------------------------
// 参数与命令
// ---------------------------------------------------------------------------

const parseArguments = (argv) => {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`)
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${token}`)
    }
    options[token.slice(2)] = value
    index += 1
  }
  return options
}

const git = (...args) =>
  execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

// ---------------------------------------------------------------------------
// 变更范围
// ---------------------------------------------------------------------------

/** 能走到 `head` 的发布标签。分支上的孤立标签不该进变更范围。 */
const listReachableTags = (head) =>
  git('tag', '--list', '--merged', head, '--sort=-v:refname', 'v*')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

const listAllTags = () =>
  git('tag', '--list', 'v*')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

const parseVersion = (tag) => {
  const matched = tag.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!matched) {
    return null
  }
  return {
    tag,
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    prerelease: matched[4] ?? null,
  }
}

/** 标准 semver 优先级：预发布低于同号正式版，标识符数字段按数值比、字母段按字典序。 */
const compareVersions = (left, right) => {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1
    }
  }

  if (left.prerelease === right.prerelease) {
    return 0
  }
  if (left.prerelease === null) {
    return 1
  }
  if (right.prerelease === null) {
    return -1
  }

  const leftParts = left.prerelease.split('.')
  const rightParts = right.prerelease.split('.')

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]
    if (leftPart === undefined) {
      return -1
    }
    if (rightPart === undefined) {
      return 1
    }
    if (leftPart === rightPart) {
      continue
    }

    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) < Number(rightPart) ? -1 : 1
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    }
    return leftPart < rightPart ? -1 : 1
  }

  return 0
}

/**
 * 上一个发布标签，两级判定：
 *
 * ① 先取「走得到的标签里离终点最近的那个」——它表达的是「这一版是从哪儿长出来的」，
 *    跨分支回合并、补发旧线补丁时都对。
 * ② 祖先关系查不出来时（浅克隆，或标签指向的提交不在终点历史里），退回语义化版本：
 *    取比当前版本低的最大者。这里不能交给 git 的 `versionsort`，它默认把 `-rc.1`
 *    这类后缀排在同号正式版**之后**，`v1.0.0` 与 `v1.0.0-rc.8` 并存时会选反。
 */
const resolvePreviousTag = (currentTag, head) => {
  const distances = listReachableTags(head)
    .filter(tag => tag !== currentTag)
    .map(tag => ({ tag, distance: Number(git('rev-list', '--count', `${tag}..${head}`)) }))
    .filter(candidate => candidate.distance > 0)

  distances.sort((left, right) => left.distance - right.distance)
  if (distances[0]) {
    return distances[0].tag
  }

  const current = parseVersion(currentTag)
  if (!current) {
    return null
  }

  return listAllTags()
    .map(parseVersion)
    .filter(version => version && compareVersions(version, current) < 0)
    .sort(compareVersions)
    .at(-1)?.tag ?? null
}

// ---------------------------------------------------------------------------
// 提交解析
// ---------------------------------------------------------------------------

const recordSeparator = '\u001e'
const fieldSeparator = '\u001f'

const readCommits = (range, head) => {
  const format = ['%s', '%b'].join(fieldSeparator) + recordSeparator
  const args = ['log', '--no-merges', `--format=${format}`]
  if (range) {
    args.push(range)
  }
  args.push(head)
  return git(...args)
    .split(recordSeparator)
    .map(record => record.replace(/^\s*\n/, '').trimEnd())
    .filter(Boolean)
    .map((record) => {
      const [subject, ...bodyParts] = record.split(fieldSeparator)
      return { subject: subject.trim(), body: bodyParts.join(fieldSeparator).trim() }
    })
}

const subjectPattern = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/s

const parseSubject = (subject) => {
  const matched = subject.match(subjectPattern)
  if (!matched) {
    return { type: null, scope: null, breaking: false, summary: subject }
  }
  return {
    type: matched[1],
    scope: matched[2] ?? null,
    breaking: Boolean(matched[3]),
    summary: matched[4].trim(),
  }
}

/** `BREAKING CHANGE:` 的正文，取到下一个 footer 为止。 */
const readBreakingBody = (body) => {
  const lines = body.split('\n')
  const start = lines.findIndex(line => /^BREAKING[ -]CHANGE:\s*/i.test(line))
  if (start === -1) {
    return null
  }

  const collected = []
  for (const line of lines.slice(start, start + 12)) {
    if (collected.length > 0 && /^[A-Za-z-]+:\s/.test(line)) {
      break
    }
    collected.push(line.replace(/^BREAKING[ -]CHANGE:\s*/i, '').trim())
  }

  return collected.filter(Boolean).join(' ').trim() || null
}

/** 标签是否在终点历史里。不在的话，`标签..终点` 不是变更是「两棵子树求差」。 */
const isAncestorOfHead = (tag, head) => {
  try {
    git('merge-base', '--is-ancestor', tag, head)
    return true
  } catch {
    return false
  }
}

/**
 * 变更范围。额外处理一种真实发生过的情况：历史被重写后，旧的发布标签留在旧血统上，
 * 此时 `标签..HEAD` 会把两边不相干的三百多个提交全算进来，说明会直接失控。
 * 这时退成按时间划范围——上一个发布之后落进主干的提交，才是这一版真的变了的东西。
 */
const resolveRange = (previousTag, head) => {
  if (!previousTag) {
    return { range: null, description: 'the whole history' }
  }
  if (isAncestorOfHead(previousTag, head)) {
    return { range: `${previousTag}..${head}`, description: previousTag }
  }

  const since = git('log', '-1', '--format=%cI', previousTag).trim()
  return { range: `--since=${since}`, description: `commits since ${previousTag} (${since})` }
}

const releaseCommitPattern = /^chore\(release\):/i

const classify = (commits) => {
  const breaking = []
  const buckets = new Map(groups.map(group => [group.title, []]))
  buckets.set(fallbackGroupTitle, [])

  for (const commit of commits) {
    if (releaseCommitPattern.test(commit.subject)) {
      continue
    }

    const parsed = parseSubject(commit.subject)
    const breakingBody = readBreakingBody(commit.body)
    if (parsed.breaking || breakingBody) {
      breaking.push(breakingBody ?? parsed.summary)
    }

    const group = groups.find(candidate => candidate.types.includes(parsed.type))
    buckets.get(group?.title ?? fallbackGroupTitle).push({
      scope: parsed.scope,
      summary: parsed.summary,
    })
  }

  return { breaking, buckets }
}

// ---------------------------------------------------------------------------
// 产物表格
// ---------------------------------------------------------------------------

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 把 electron-builder 的 `artifactName` 模板翻成可以抓出 os / arch 的正则。 */
const buildArtifactPattern = (template, version) => {
  const body = template
    .split(/(\$\{[^}]+\})/)
    .map((part) => {
      const token = part.match(/^\$\{([^}]+)\}$/)?.[1]
      if (!token) {
        return escapeRegExp(part)
      }
      if (token === 'version') {
        return escapeRegExp(version)
      }
      if (token === 'os' || token === 'arch' || token === 'ext') {
        return `(?<${token}>[A-Za-z0-9_]+)`
      }
      // 其它占位符（channel / name …）不参与判定，放行但不当分组用。
      return '[A-Za-z0-9_.-]+'
    })
    .join('')

  return new RegExp(`^${body}$`)
}

const guessPlatformFromExtension = (extension) => {
  if (extension === '.dmg' || extension === '.zip' || extension === '.pkg') {
    return 'mac'
  }
  if (extension === '.exe' || extension === '.msi') {
    return 'win'
  }
  if (extension === '.appimage' || extension === '.deb' || extension === '.rpm') {
    return 'linux'
  }
  return null
}

const listFiles = (directory) => {
  const found = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...listFiles(entryPath))
    } else {
      found.push(entryPath)
    }
  }
  return found
}

const formatSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * 产物清单。两种来源：
 *
 * - `--assets-dir`：发布链里用，读 CI 收集下来的真实文件，大小取文件字节数。
 * - `--assets-json`：补写已发布版本的说明时用。安装包动辄几百 MB，为了拿文件名和大小
 *   再下载一遍没意义，直接吃 `gh api` 的资产清单（见文件头用法）。接受裸数组，
 *   也接受 `gh release view --json assets` 那种带 `assets` 字段的对象。
 */
const readAssetEntries = (options) => {
  if (options['assets-dir']) {
    const directory = options['assets-dir']
    // 宁可报错也不静默省略表格：少了下载表就是「发出去的说明缺了一块」，
    // 而失败会直接拦住发布。
    if (!fs.existsSync(directory)) {
      fail(`Assets directory does not exist: ${directory}`)
    }
    return listFiles(directory).map(file => ({
      name: path.basename(file),
      size: fs.statSync(file).size,
    }))
  }

  if (options['assets-json']) {
    if (!fs.existsSync(options['assets-json'])) {
      fail(`Assets list does not exist: ${options['assets-json']}`)
    }
    // 去掉可能的 BOM：Windows 上按文档里的重定向写法存盘时很容易带上，
    // 而 JSON.parse 会因为它直接把整份清单判为非法。
    const text = fs.readFileSync(options['assets-json'], 'utf8').replace(/^\uFEFF/, '')
    const payload = JSON.parse(text)
    const entries = Array.isArray(payload) ? payload : payload.assets
    if (!Array.isArray(entries)) {
      fail(`Cannot read assets from ${options['assets-json']}: expected an array, or an object with an "assets" array`)
    }
    return entries
      .filter(entry => entry && typeof entry.name === 'string')
      .map(entry => ({ name: entry.name, size: Number(entry.size) || 0 }))
  }

  return []
}

const buildAssetRows = (entries, template, version, repository, tag) => {
  const names = new Set(entries.map(entry => entry.name))
  const pattern = buildArtifactPattern(template, version)

  const rows = []
  for (const entry of entries) {
    const { name } = entry
    const extension = path.extname(name).toLowerCase()
    if (!installerExtensions.includes(extension)) {
      continue
    }

    const matched = name.match(pattern)
    const platformKey = matched?.groups?.os ?? guessPlatformFromExtension(extension)
    const arch = matched?.groups?.arch ?? null
    const platform = platformKey ? platformKey.toLowerCase() : 'other'
    const downloadUrl = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`

    rows.push({
      platform,
      arch,
      label: archLabels[platform]?.[arch] ?? (arch ? arch.toUpperCase() : null),
      name,
      size: formatSize(entry.size),
      downloadUrl,
      checksumUrl: names.has(`${name}.sha256`)
        ? `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}.sha256`
        : null,
    })
  }

  rows.sort((left, right) => {
    const leftPlatform = platformOrder.indexOf(left.platform)
    const rightPlatform = platformOrder.indexOf(right.platform)
    if (leftPlatform !== rightPlatform) {
      return (leftPlatform === -1 ? platformOrder.length : leftPlatform)
        - (rightPlatform === -1 ? platformOrder.length : rightPlatform)
    }
    return (left.arch ?? '').localeCompare(right.arch ?? '')
  })

  return rows
}

const renderAssets = (rows, repository) => {
  if (rows.length === 0) {
    return []
  }

  const lines = [
    '### Downloads',
    '',
    '| Platform | File | Size | Checksum |',
    '| --- | --- | --- | --- |',
  ]

  for (const row of rows) {
    const platform = [platformLabels[row.platform] ?? row.platform, row.label].filter(Boolean).join(' · ')
    const checksum = row.checksumUrl ? `[SHA-256](${row.checksumUrl})` : '—'
    lines.push(`| ${platform} | [\`${row.name}\`](${row.downloadUrl}) | ${row.size} | ${checksum} |`)
  }

  lines.push(
    '',
    'The `.zip`, `*.blockmap` and `latest*.yml` files next to them are what the built-in updater downloads; you do not need them.',
    '',
    `macOS builds are ad-hoc signed and not notarized. If the system blocks the first launch, allow it under System Settings → Privacy & Security, or right-click the app in Finder and choose Open — see [Install](https://github.com/${repository}/blob/HEAD/README.md#install) for the full steps.`,
  )

  return lines
}

// ---------------------------------------------------------------------------
// 组装
// ---------------------------------------------------------------------------

const renderNotes = ({ breaking, buckets, assets, repository, tag, previousTag }) => {
  const lines = []

  if (breaking.length > 0) {
    lines.push('### ⚠️ Breaking changes', '')
    lines.push(...breaking.map(item => `- ${item}`))
    lines.push('')
  }

  for (const group of [...groups, { title: fallbackGroupTitle }]) {
    const items = buckets.get(group.title) ?? []
    if (items.length === 0) {
      continue
    }
    lines.push(`### ${group.title}`, '')
    lines.push(...items.map(item => (item.scope ? `- **${item.scope}**: ${item.summary}` : `- ${item.summary}`)))
    lines.push('')
  }

  if (lines.length === 0) {
    lines.push(`No commit changes since ${previousTag ?? 'the beginning of the history'}.`, '')
  }

  const assetLines = renderAssets(assets, repository)
  if (assetLines.length > 0) {
    lines.push(...assetLines, '')
  }

  const compareUrl = previousTag
    ? `https://github.com/${repository}/compare/${previousTag}...${tag}`
    : `https://github.com/${repository}/commits/${tag}`
  lines.push(`**Full Changelog**: ${compareUrl}`)

  return `${lines.join('\n').trimEnd()}\n`
}

const options = parseArguments(process.argv.slice(2))
const rootManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'))
const version = options.version ?? rootManifest.version
const tag = options.tag ?? `v${version}`

log.title(`Release notes for ${tag}`)

const builderConfig = (await import(pathToFileURL(path.join(repositoryRoot, 'apps/app/electron-builder.config.cjs')).href)).default
const repository = options.repository ?? `${builderConfig.publish.owner}/${builderConfig.publish.repo}`

// `--head` 默认 HEAD；补写已经发出去的版本时要指到那个标签，否则之后合进来的提交
// 会跟着算进那一版的说明里。
const head = options.head ?? 'HEAD'

// 允许显式指定起点：重发旧版本、或从分支回合并时，自动挑出来的「上一个标签」可能不是想要的那个。
const previousTag = options.previous === undefined ? resolvePreviousTag(tag, head) : options.previous
const { range, description: rangeDescription } = resolveRange(previousTag, head)

const { breaking, buckets } = classify(readCommits(range, head))
const assets = buildAssetRows(
  readAssetEntries(options),
  builderConfig.artifactName,
  version,
  repository,
  tag,
)

const notes = renderNotes({ breaking, buckets, assets, repository, tag, previousTag })

if (options.output) {
  const outputPath = path.resolve(options.output)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, notes)
} else {
  process.stdout.write(notes)
}

const commitCount = [...buckets.values()].reduce((count, items) => count + items.length, 0)
log.info(`range: ${rangeDescription}`)
log.info(`commits: ${commitCount} (${breaking.length} breaking)`)
log.info(`installers: ${assets.length}`)
log.success(options.output ? `Written to ${options.output}` : 'Generated')
