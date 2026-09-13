/**
 * 测试用数据文件名。
 *
 * 刻意用一个固定的普通文件名：测试都跑在各自的临时目录里，文件名不参与任何断言，因此不需要跟着
 * 应用版本号走（命名规则本身由 `packages/contracts/source/database-file.test.ts` 单独验证）。
 */
export const TEST_DATABASE_FILE_NAME = 'one-switch-test.db'
