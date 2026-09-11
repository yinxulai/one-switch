/**
 * 数据文件名规则。
 *
 * 数据文件名带上应用的**主版本号**：不兼容的结构换代时，新版本会去开一个全新的数据文件，
 * 旧文件原样留在磁盘上，既不会被打开也不会被删除，所以既不需要写迁移，也不需要检测旧结构。
 * 预览阶段这条规则就是「换代」的全部机制，见 `product/data-model.md` 的数据库初始化策略。
 */
export const DATABASE_FILE_PREFIX = 'one-switch'

/** 从应用版本号取主版本号：`1.0.0-rc.6` → `1`。 */
export function getMajorVersion(appVersion: string): number {
  const matched = /^v?(\d+)/.exec(appVersion.trim())
  if (!matched) throw new Error(`无法从应用版本号解析主版本号: ${appVersion}`)

  return Number(matched[1])
}

/** 数据文件名：`one-switch-v1.db`。 */
export function createDatabaseFileName(appVersion: string): string {
  return `${DATABASE_FILE_PREFIX}-v${getMajorVersion(appVersion)}.db`
}
