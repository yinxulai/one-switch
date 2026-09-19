/**
 * 数据文件名规则。
 *
 * 一个数据目录里有**两个**数据库，各自带自己的 schema 版本号：
 *
 *   - `osw-config-v1.db`——配置库，用户写的东西（供应商、模型、路由、改写规则、设置）；
 *   - `osw-data-v1.db`——数据库，系统写的东西（请求日志、用量、正文、运行时日志、健康状态）。
 *
 * 文件名里的数字是**该文件自己的 schema 版本**：手写常量，不在启动时从 `app.getVersion()` 推导，
 * 而是只在**应用大版本发布**时加一，目的是甩掉累积的迁移历史——换名字就是换文件，新文件从一份
 * 重新生成的基线开始，旧文件原样留在磁盘上、既不读也不删。两个库各自维护自己的数字，可以停在不同
 * 版本上。
 *
 * **日常的结构变化不走这条路**——为它加一条迁移就够了（`packages/core/drizzle/<role>/` 下每个目录
 * 是一条），否则每次加列都会把用户已经写好的配置甩在一张空表旁边。
 *
 * 见 `docs/product/data-model.md` 的数据库初始化策略。
 */
export const DATABASE_FILE_PREFIX = 'osw'

/**
 * 数据库角色。
 *
 * `config` 与 `data` 之间**不存在**外键、JOIN 与事务：这是拆成两个文件的前提，也是拆开
 * 之后必须一直成立的不变量，由 `packages/core/scripts/check-database-boundaries.mjs`
 * 静态守住。
 */
export type DatabaseRole = 'config' | 'data'

export const DATABASE_ROLES: readonly DatabaseRole[] = ['config', 'data']

/**
 * 各库当前的 schema 版本。
 *
 * 只在**应用大版本发布**时手动加一，而且要和「重新生成基线」一起做：加一等于换一个文件名，
 * 新文件从一个干净的首发基线建起，旧文件原地留下。日常改结构**不要**动这里——加一条迁移。
 */
export const DATABASE_SCHEMA_VERSIONS: Record<DatabaseRole, number> = {
  config: 1,
  data: 1,
}

/** 数据文件名：`osw-config-v1.db` / `osw-data-v1.db`。 */
export function createDatabaseFileName(role: DatabaseRole): string {
  return `${DATABASE_FILE_PREFIX}-${role}-v${DATABASE_SCHEMA_VERSIONS[role]}.db`
}

/** 本版本会打开的全部数据文件名（= 启动横幅里列出的那两个）。 */
export function listCurrentDatabaseFileNames(): string[] {
  return DATABASE_ROLES.map(createDatabaseFileName)
}
