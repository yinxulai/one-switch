import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { DATABASE_FILE_PREFIX } from '@common/database-file'
import { BUILT_IN_DEFAULT_LOGICAL_MODEL_DESCRIPTION, BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME } from '@common/schemas'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'

export type Database = ReturnType<typeof drizzle>

let database: Database | null = null
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))

/**
 * 打开（必要时创建）数据文件。
 *
 * `databaseFileName` 由应用入口给出（`createDatabaseFileName(app.getVersion())`）而不是在这里推导：
 * 文件名带主版本号，是「换了不兼容结构就换一个文件」这条策略的载体，所以它必须由知道应用版本的
 * 那一层提供，而不是由数据库层去猜。
 */
export async function initDatabase(dataDir: string, databaseFileName: string): Promise<Database> {
  if (database) {
    console.debug('[database] initialization skipped reason=already-initialized')
    return database
  }

  const startedAt = Date.now()
  console.info(`[database] initialization started file=${databaseFileName}`)
  fs.mkdirSync(dataDir, { recursive: true })
  const databasePath = path.join(dataDir, databaseFileName)
  const migrationsFolder = getMigrationsFolder()
  warnAboutOtherDatabaseFiles(dataDir, databaseFileName)
  const client = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
  })

  try {
    client.exec('PRAGMA journal_mode = WAL')
    // 读密集型分析查询的调优：句柄是长驻的，这几个参数一次设定、全程生效。
    //
    // `temp_store = MEMORY`：分析聚合几乎都带 `GROUP BY` / `ORDER BY`，SQLite 为此
    // 要建临时 B 树。默认走磁盘临时文件（约 1.9 万行/秒的写盘往返），落在内存里则
    // 没有这段 IO。数据量再大也只是临时文件放内存，结果正确性不受影响。
    // `cache_size = -64000`：默认页缓存只有 2MB，150k 行的日志表随便扫一遍就把它冲干净了，
    // 分析查询又会连着访问同样的页。64MB 上限对桌面应用是可接受的开销。
    // `synchronous = NORMAL`：WAL 下该档位不会因进程崩溃丢已提交数据，只有整机掉电
    // 才可能丢最后几个事务——代理每次请求都要写日志，这个取舍对写入延迟的收益是值得的。
    client.exec('PRAGMA temp_store = MEMORY')
    client.exec('PRAGMA cache_size = -64000')
    client.exec('PRAGMA synchronous = NORMAL')
    assertDatabaseIsSupported(client, migrationsFolder, databasePath)
    const db = drizzle({ client })
    // 迁移期间必须放下外键约束：重建式迁移（建新表 → 拷数据 → 删旧表 → 改名）删旧表时的隐式
    // 删除会撞上子表的外键，而 Drizzle 自己写的 `PRAGMA foreign_keys=OFF` 落在它的迁移事务
    // 内部，SQLite 会忽略。迁移结束后立即恢复，运行期约束强度不受影响。
    // 当前 `drizzle/` 只有一个纯建表的首发基线，这段是为了让将来生成的迁移仍然成立。
    client.exec('PRAGMA foreign_keys = OFF')
    try {
      migrate(db, { migrationsFolder })
    } finally {
      client.exec('PRAGMA foreign_keys = ON')
    }
    ensureDefaultLogicalModel(client)
    reconcileInterruptedRequests(client)
    // 补一次统计信息。`ANALYZE` 的结果（`sqlite_stat1`）决定查询规划器选哪个索引，
    // 而规划器在没有统计信息时是按「每个索引都一样好」的默认假设估的——实测中它因此
    // 给带时间窗的聚合选了更差的路径。`optimize` 只在统计信息缺失或已过期时才会真正分析，
    // 因此常规启动几乎不花时间；新建的空库也会被它立刻标记为「已有统计信息」。
    client.exec('PRAGMA optimize')
    database = db
    console.info(`[database] initialization completed duration=${Date.now() - startedAt}ms`)
    return database
  } catch (error) {
    client.close()
    database = null
    console.error(`[database] initialization failed duration=${Date.now() - startedAt}ms`, error)
    throw error
  }
}

export function getDb(): Database {
  if (!database) throw new Error('Database not initialized')
  return database
}

export async function closeDatabase(): Promise<void> {
  if (!database) {
    console.debug('[database] close skipped reason=not-initialized')
    return
  }
  const activeDatabase = database
  database = null
  try {
    activeDatabase.$client.close()
    console.info('[database] closed')
  } catch (error) {
    console.error('[database] close failed', error)
    throw error
  }
}

function getMigrationsFolder(): string {
  // 迁移基线随核心包分发，但它和编译产物的相对深度在两种形态下并不一样：
  //
  //   - 打包后：electron-builder 把 `packages/core/drizzle` 映射进 asar
  //     （见 `apps/app/electron-builder.config.cjs`），模块住在 `app.asar/dist/command/`，
  //     上溯两层就是 asar 根。
  //   - 开发期：模块住在 `apps/app/dist/command/`，上溯两层只会落到 `apps/app`，
  //     要到仓库根得上溯四层。
  //
  // 与其在代码里写死两套深度，不如从模块目录逐级上溯找那个包目录：两种形态都命中，
  // 将来产物布局再变也不会静默失配。从仓库根直接跑 core（测试、本地脚本）时模块目录
  // 反而不在链路里，所以最后用 cwd 兜一次。
  let directory = moduleDirectory
  for (let level = 0; level < 8; level += 1) {
    const candidate = path.join(directory, 'packages/core/drizzle')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  const fromWorkingDirectory = path.join(process.cwd(), 'packages/core/drizzle')
  if (fs.existsSync(fromWorkingDirectory)) return fromWorkingDirectory
  // 全部落空时返回「产物形态下的期望位置」，让上层的报错指向一个可解释的路径。
  return path.join(moduleDirectory, 'packages/core/drizzle')
}

/**
 * 提示数据目录里其他版本的数据文件。
 *
 * 文件名带主版本号 ⇒ 换代后旧文件不会被动用，也不会被删除（用户可以自己取回旧数据）。但如果不
 * 提示，用户只会看到「日志页面空了」。这里只写一条日志，不对文件做任何处理。
 */
function warnAboutOtherDatabaseFiles(dataDir: string, databaseFileName: string): void {
  const others = fs
    .readdirSync(dataDir)
    .filter(name => name !== databaseFileName && name.startsWith(DATABASE_FILE_PREFIX) && name.endsWith('.db'))
  if (others.length === 0) return

  console.warn(
    `[database] found database files of other versions file=${others.join(',')} note="not used by this version; back up and delete them (together with -wal/-shm) if unwanted"`,
  )
}

/**
 * 拒绝在不受支持的数据库上启动。
 *
 * One Switch 还在 preview 阶段，数据库结构只由 `drizzle/` 下的单个首发基线创建，不存在任何
 * 升级路径：旧版本的库即使表名恰好相同，列与约束也未必一致，让它继续跑只会把错误推迟到运行
 * 期的某次写入。所以这里只做一件事——判定数据库不是本版本创建的，就明确报错要求重新初始化，
 * 而不是尝试修补（产品约定见 `product/data-model.md` 的数据库初始化策略）。
 *
 * 判定依据是 migration 记录而不是表名清单：只要记录里出现了本地基线之外的 migration，或者库里
 * 有表却没有任何 migration 记录，就说明它来自另一条历史。这样无论旧库长什么样都不需要维护一份
 * 「历史表名」列表，代价是要求 `drizzle/` 里的基线一旦发布就只能是追加式演进。
 *
 * 数据文件名已经带了主版本号，正常情况下这个函数见不到旧库（旧库在别的文件里）。它守的是
 * 「文件被改名/拷错/来自别的分支」这类拿错库的情况。
 */
function assertDatabaseIsSupported(client: DatabaseSync, migrationsFolder: string, databasePath: string): void {
  const tables = client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
  if (tables.length === 0) return

  const supportedNames = new Set(listMigrationNames(migrationsFolder))
  const appliedNames = readAppliedMigrationNames(client)
  const unsupportedNames = appliedNames.filter(name => !supportedNames.has(name))
  if (appliedNames.length > 0 && unsupportedNames.length === 0) return

  console.error(
    `[database] unsupported database file=${databasePath} tables=${tables.length} applied=${appliedNames.length} unsupported=${unsupportedNames.length}`,
  )
  throw new Error(
    `Unsupported database file: ${databasePath}\n` +
      'One Switch is in preview: the schema is created directly from the initial baseline and no upgrade path for older databases is provided.\n' +
      'Back up the file yourself, then delete it (together with the -wal / -shm files next to it) and restart the app to reinitialize from scratch.',
  )
}

function listMigrationNames(migrationsFolder: string): string[] {
  if (!fs.existsSync(migrationsFolder)) {
    throw new Error(`Database initialization failed: missing migrations folder ${migrationsFolder}`)
  }
  return fs
    .readdirSync(migrationsFolder, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
}

/** 读取 Drizzle 记账表；库由其他来源创建时这张表不存在，返回空数组以区分「没跑过」和「跑过别的」。 */
function readAppliedMigrationNames(client: DatabaseSync): string[] {
  const bookkeeping = client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get()
  if (!bookkeeping) return []

  return (client.prepare('SELECT name FROM __drizzle_migrations').all() as { name: unknown }[])
    .map(row => row.name)
    .filter((name): name is string => typeof name === 'string')
}

/**
 * 保证内建默认逻辑模型存在。
 *
 * 这条记录是内建「模型直达」规则的落点：客户端发来的模型名大概率不是本机配的逻辑模型，
 * 没有它就没有任何可用的上游起点。名字取 `BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME`，
 * 与服务端的回落匹配共用同一个常量。
 */
function ensureDefaultLogicalModel(db: DatabaseSync): void {
  const time = BigInt(Date.now())
  db.prepare(`INSERT OR IGNORE INTO logical_models
    (id, name, description, enabled, createdTime, updatedTime)
    VALUES (?, ?, ?, 1, ?, ?)`)
    .run(BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME, BUILT_IN_DEFAULT_LOGICAL_MODEL_NAME, BUILT_IN_DEFAULT_LOGICAL_MODEL_DESCRIPTION, time, time)
}

/**
 * 回收上一次运行遗留的「进行中」请求。
 *
 * 请求行在拿到结果之前就已写入，所以进程被杀掉（崩溃、强制退出）时会留下永远
 * 停在 `pending` 的行：它既不会被后续写入更新，也不会被保留期清理回收，只会让
 * 日志列表永久显示一条「进行中」。
 *
 * 收尾为 `cancelled` 是唯诚实的选项：我们确实没有观察到这次请求的结果，
 * 既不能假装成功，也没有任何失败证据可以归因。
 */
function reconcileInterruptedRequests(db: DatabaseSync): void {
  const result = db.prepare("UPDATE request_logs SET status = 'cancelled' WHERE status = 'pending'").run()
  if (result.changes > 0) console.info(`[database] reconciled interrupted request logs count=${result.changes}`)
}
