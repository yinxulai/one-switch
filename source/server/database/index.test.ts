import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabaseFileName } from '@common/database-file'
import { closeDatabase, getDb, initDatabase } from './index'
import { TEST_DATABASE_FILE_NAME } from './test-support'
import { listProviderModelsForLogicalModel } from './model-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await closeDatabase()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-db-'))
  temporaryDirectories.push(directory)
  return directory
}

/** 伪造一个「不是本版本创建」的数据库：有表，并可选地带一份别的 migration 记账。 */
function createUnsupportedDatabase(directory: string, appliedNames: string[]): void {
  const client = new DatabaseSync(path.join(directory, TEST_DATABASE_FILE_NAME))
  client.exec('CREATE TABLE request_logs (id TEXT PRIMARY KEY)')
  if (appliedNames.length > 0) {
    client.exec('CREATE TABLE __drizzle_migrations (id integer PRIMARY KEY, hash text, created_at numeric, name text)')
    const insert = client.prepare('INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES (?, ?, ?)')
    appliedNames.forEach((name, index) => insert.run(`hash-${index}`, index, name))
  }
  client.close()
}

describe('database lifecycle', () => {
  it('clears the database reference on close and supports reinitialization', async () => {
    const first = await initDatabase(createTemporaryDirectory(), TEST_DATABASE_FILE_NAME)
    expect(first.$client.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })

    await closeDatabase()

    expect(() => getDb()).toThrow('Database not initialized')

    const second = await initDatabase(createTemporaryDirectory(), TEST_DATABASE_FILE_NAME)
    expect(second.$client.prepare('SELECT 1 AS value').get()).toEqual({ value: 1 })
    expect(getDb()).toBe(second)
  })

  it('can be closed repeatedly', async () => {
    await initDatabase(createTemporaryDirectory(), TEST_DATABASE_FILE_NAME)

    await closeDatabase()

    await expect(closeDatabase()).resolves.toBeUndefined()
  })

  it('seeds the default logical model on a fresh database', async () => {
    const client = (await initDatabase(createTemporaryDirectory(), TEST_DATABASE_FILE_NAME)).$client

    const rows = client.prepare('SELECT id, name, enabled FROM logical_models').all()
    expect(rows).toEqual([{ id: 'default', name: 'default', enabled: 1 }])
  })

  it('restores default when a database has no logical model', async () => {
    const directory = createTemporaryDirectory()
    const client = (await initDatabase(directory, TEST_DATABASE_FILE_NAME)).$client
    const time = Date.now()

    client.prepare('DELETE FROM logical_models').run()
    client
      .prepare('INSERT INTO logical_models (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)')
      .run('custom', 'Custom', time, time)

    await closeDatabase()
    const reopened = (await initDatabase(directory, TEST_DATABASE_FILE_NAME)).$client

    const rows = reopened.prepare('SELECT id FROM logical_models ORDER BY id').all()
    expect(rows).toEqual([{ id: 'custom' }, { id: 'default' }])
  })

  it('creates the v0.3 relational baseline with an idempotent default model', async () => {
    const directory = createTemporaryDirectory()
    const client = (await initDatabase(directory, TEST_DATABASE_FILE_NAME)).$client
    const expectedTables = [
      'settings', 'providers', 'provider_health', 'provider_model_health',
      'provider_models', 'provider_settings', 'provider_endpoints',
      'provider_model_endpoints', 'protocol_converters', 'logical_models', 'workflows', 'request_rewrite_rules', 'provider_model_request_rewrite_rules',
      'scheduling_policies', 'request_logs', 'request_attributes', 'request_usages',
      'request_attempts', 'attempt_usages', 'request_contents', 'attempt_contents', 'runtime_logs',
    ]
    const tables = client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(row => (row as { name: string }).name)

    expect(tables).toEqual(['__drizzle_migrations', ...expectedTables].sort())
    expect(client.prepare('SELECT id, name FROM logical_models').all()).toEqual([
      { id: 'default', name: 'default' },
    ])

    await closeDatabase()
    const reopened = (await initDatabase(directory, TEST_DATABASE_FILE_NAME)).$client
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM logical_models').get()).toEqual({ count: 1 })
  })

  it('enforces v0.3 binding uniqueness and health foreign keys', async () => {
    const client = (await initDatabase(createTemporaryDirectory(), TEST_DATABASE_FILE_NAME)).$client
    const time = Date.now()
    client.prepare('INSERT INTO providers (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)').run('prov_test', 'Test', time, time)
    client.prepare('INSERT INTO provider_models (id, providerId, modelName, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?)').run('pm_test', 'prov_test', 'model-a', time, time)
    client.prepare('INSERT INTO scheduling_policies (logicalModelId, providerModelId, priority, weight, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?)').run('default', 'pm_test', 0, 100, time, time)

    expect(() => client.prepare('INSERT INTO scheduling_policies (logicalModelId, providerModelId, createdTime, updatedTime) VALUES (?, ?, ?, ?)').run('default', 'pm_test', time, time)).toThrow()
    expect(() => client.prepare('INSERT INTO provider_health (providerId, updatedTime) VALUES (?, ?)').run('missing', time)).toThrow()
  })

  it('keeps disabled models in management list while excluding them from scheduling', async () => {
    const client = (await initDatabase(createTemporaryDirectory(), TEST_DATABASE_FILE_NAME)).$client
    const time = Date.now()
    client.prepare('INSERT INTO providers (id, name, createdTime, updatedTime) VALUES (?, ?, ?, ?)').run('prov_test', 'Test', time, time)
    client.prepare('INSERT INTO provider_models (id, providerId, modelName, enabled, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?)').run('pm_disabled', 'prov_test', 'model-disabled', 0, time, time)
    client.prepare('INSERT INTO scheduling_policies (logicalModelId, providerModelId, priority, weight, createdTime, updatedTime) VALUES (?, ?, ?, ?, ?, ?)').run('default', 'pm_disabled', 0, 100, time, time)

    await expect(listProviderModelsForLogicalModel('default')).resolves.toEqual([])
    await expect(listProviderModelsForLogicalModel('default', false, true)).resolves.toMatchObject([
      { id: 'pm_disabled', enabled: false, priority: 0 },
    ])
  })

  it('creates the expected v0.3 indexes and request columns', async () => {
    const client = (await initDatabase(createTemporaryDirectory(), TEST_DATABASE_FILE_NAME)).$client
    const requestLogColumns = client.prepare('PRAGMA table_info(request_logs)').all()
    const settingsColumns = client.prepare('PRAGMA table_info(settings)').all()
    const attemptColumns = client.prepare('PRAGMA table_info(request_attempts)').all()
    const workflowColumns = client.prepare('PRAGMA table_info(workflows)').all()
    const indexes = client.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()

    // `PRAGMA table_info` 返回的是物理列顺序；整库现在由一个首发基线建表，物理顺序等于
    // schema 声明顺序。这里仍然比较集合，避免测试在有人重排 `schema.ts` 时无意义地变红。
    expect(requestLogColumns.map(column => (column as { name: string }).name).sort()).toEqual([
      'clientProtocol', 'createdTime', 'id', 'logicalModelId', 'status', 'totalDurationMilliseconds', 'transport',
    ])
    expect(settingsColumns.map(column => (column as { name: string }).name)).toEqual([
      'key', 'value', 'valueType', 'updatedTime',
    ])
    expect(attemptColumns.map(column => (column as { name: string }).name)).toEqual(
      expect.arrayContaining(['providerModelId', 'providerName', 'providerModelName', 'url', 'httpStatus', 'retryable', 'upstreamTransport', 'ttftMilliseconds', 'requestRewriteRuleIds', 'responseRewriteRuleIds']),
    )
    expect(workflowColumns.map(column => (column as { name: string }).name).sort()).toEqual([
      'createdTime', 'definition', 'deletedTime', 'id', 'name', 'type', 'updatedTime', 'version',
    ])
    expect(indexes.map(index => (index as { name: string }).name)).toEqual(
      expect.arrayContaining(['idx_scheduling_policies_route', 'idx_request_attempts_request_order', 'idx_request_attributes_key_value', 'idx_runtime_logs_timestamp', 'idx_workflows_type_version', 'idx_provider_model_request_rewrite_rule_priority_active']),
    )
    // 历史遗留：早期迁移建过一个不带 `deletedTime IS NULL` 的全量唯一索引，它与当前设计
    // 使用的部分唯一索引语义冲突，会挡住「软删除旧绑定后在同 priority 绑定新规则」。
    // 那条索引已经随历史一起删掉了（首发基线只建部分唯一索引），断言保留是为了防止有人重新
    // 生成基线时又把它带回来——它只会在运行期以写入失败的形式暴露。
    expect(indexes.map(index => (index as { name: string }).name)).not.toContain('idx_model_request_rewrite_rule_priority')
  })
})

describe('unsupported database detection', () => {
  it('refuses a database whose migration records are not the baseline', async () => {
    const directory = createTemporaryDirectory()
    createUnsupportedDatabase(directory, ['20250101000000_legacy_baseline', '20250202000000_legacy_followup'])

    await expect(initDatabase(directory, TEST_DATABASE_FILE_NAME)).rejects.toThrow(/Unsupported database file[\s\S]*delete it/)
    expect(() => getDb()).toThrow('Database not initialized')

    // 拒绝就是拒绝：旧库必须原样留在磁盘上，等用户自己备份或删除。
    const client = new DatabaseSync(path.join(directory, TEST_DATABASE_FILE_NAME))
    const tables = client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    client.close()
    expect(tables).toEqual([{ name: '__drizzle_migrations' }, { name: 'request_logs' }])
  })

  it('refuses a database that has tables but no migration bookkeeping', async () => {
    const directory = createTemporaryDirectory()
    createUnsupportedDatabase(directory, [])

    await expect(initDatabase(directory, TEST_DATABASE_FILE_NAME)).rejects.toThrow('Unsupported database file')
    expect(() => getDb()).toThrow('Database not initialized')
  })

  // 文件名带主版本号的意义就在这个测试里：换成另一个主版本时，应用会在一个全新的文件上初始化，
  // 旧文件连打开都不打开，因此不需要任何迁移，也不会因为读不懂旧结构而启动失败。
  it('creates the data file of the requested version and leaves other versions untouched', async () => {
    const directory = createTemporaryDirectory()
    const previousVersionPath = path.join(directory, createDatabaseFileName('0.9.0'))
    const previousVersionClient = new DatabaseSync(previousVersionPath)
    previousVersionClient.exec('CREATE TABLE previous_version_only (id TEXT PRIMARY KEY)')
    previousVersionClient.close()
    const previousVersionBytes = fs.readFileSync(previousVersionPath)

    const client = (await initDatabase(directory, createDatabaseFileName('1.0.0-rc.6'))).$client

    expect(fs.readdirSync(directory).filter(name => name.endsWith('.db')).sort()).toEqual([
      'one-switch-v0.db',
      'one-switch-v1.db',
    ])
    const previousOnly = client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'previous_version_only'")
      .all()
    expect(previousOnly).toEqual([])
    expect(fs.readFileSync(previousVersionPath)).toEqual(previousVersionBytes)
  })
})
