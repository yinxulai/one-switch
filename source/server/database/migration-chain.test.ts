import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const drizzleDirectory = fileURLToPath(new URL('../../../drizzle', import.meta.url))

interface MigrationSnapshot {
  folder: string
  id: string
  prevIds: string[]
  version: string
  dialect: string
  ddl: unknown[]
}

function listMigrationFolders(): string[] {
  return fs
    .readdirSync(drizzleDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

function readSnapshots(): MigrationSnapshot[] {
  return listMigrationFolders().map(folder => {
    const raw = JSON.parse(fs.readFileSync(path.join(drizzleDirectory, folder, 'snapshot.json'), 'utf8')) as Omit<
      MigrationSnapshot,
      'folder'
    >
    return { ...raw, folder }
  })
}

// 这些不变量保护的是 drizzle-kit 的 diff 基线选择：
// 缺失 snapshot.json 会让基线回退到更早的状态，而分叉的链（多个叶子）会被当成
// 分支合并，从而生成一份把早已应用过的 DDL 再重放一遍的假迁移。
// 当前 `drizzle/` 里只有一个首发基线，这些不变量就是「它必须保持干净」的定义；
// 将来真的开始追加迁移时，它们同样成立。
describe('drizzle migration chain integrity', () => {
  const folders = listMigrationFolders()

  it('keeps migration.sql and snapshot.json together in every folder', () => {
    const incomplete = folders.filter(
      folder =>
        !fs.existsSync(path.join(drizzleDirectory, folder, 'migration.sql')) ||
        !fs.existsSync(path.join(drizzleDirectory, folder, 'snapshot.json')),
    )

    expect(incomplete).toEqual([])
  })

  it('forms one linear snapshot chain with a single tip', () => {
    const snapshots = readSnapshots()
    const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]))
    const childCount = new Map(snapshots.map(snapshot => [snapshot.id, 0]))
    const danglingParents: string[] = []

    for (const snapshot of snapshots) {
      const isBaseline = snapshot.folder === folders[0]

      for (const prevId of snapshot.prevIds) {
        if (byId.has(prevId)) {
          childCount.set(prevId, (childCount.get(prevId) ?? 0) + 1)
        } else if (!isBaseline) {
          // 只有基线允许挂在图外（drizzle-kit 用一个全零 id 标记它），其余节点必须真实存在。
          danglingParents.push(snapshot.folder)
        }
      }

      if (!isBaseline) expect(snapshot.prevIds.length).toBeGreaterThan(0)
    }

    expect(danglingParents).toEqual([])
    expect([...childCount.entries()].filter(([, count]) => count > 1)).toEqual([])

    const leaves = snapshots.filter(snapshot => (childCount.get(snapshot.id) ?? 0) === 0)
    expect(leaves.map(snapshot => snapshot.folder)).toEqual([folders[folders.length - 1]])
  })

  it('keeps the baseline a pure create-only migration', () => {
    // preview 阶段不兼容旧库，历史里不存在需要演进的中间态，所以首发基线只能由 schema 直接
    // 生成：出现 ALTER / DROP 就说明文件被手工改过，或者更早的历史混了进来。
    const baselineSql = fs.readFileSync(path.join(drizzleDirectory, folders[0], 'migration.sql'), 'utf8')

    expect(baselineSql).toMatch(/^\s*CREATE TABLE/m)
    expect(baselineSql).not.toMatch(/^\s*(ALTER TABLE|DROP)/m)
  })

  it('writes sqlite version 7 snapshots for every link', () => {
    for (const snapshot of readSnapshots()) {
      expect({ folder: snapshot.folder, version: snapshot.version, dialect: snapshot.dialect }).toEqual({
        folder: snapshot.folder,
        version: '7',
        dialect: 'sqlite',
      })
      expect(snapshot.ddl.length).toBeGreaterThan(0)
    }
  })

  it('counts each snapshot node exactly once while walking the chain', () => {
    const snapshots = readSnapshots()
    const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]))

    let cursor: MigrationSnapshot | undefined = snapshots[snapshots.length - 1]
    const visited = new Set<string>()
    while (cursor) {
      expect(visited.has(cursor.id)).toBe(false)
      visited.add(cursor.id)
      cursor = cursor.prevIds.map(prevId => byId.get(prevId)).find(Boolean)
    }

    expect(visited.size).toBe(snapshots.length)
  })
})
