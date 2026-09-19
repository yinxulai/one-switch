import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireInstanceLock,
  isProcessAlive,
  lockFilePath,
  readLockHolder,
  refreshHeartbeat,
  releaseInstanceLock,
} from './instance-lock'

// 全程用临时目录：这个模块写的是磁盘上的真实文件，绝不能碰开发机上的数据目录。

const DEAD_PID = 2_147_483_646
/** 心跳间隔的 6 倍之外，任何一份实现都必须把它当成过期。 */
const LONG_AGO = new Date(Date.now() - 10 * 60_000).toISOString()

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-lock-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function writeLockFile(holder: unknown, raw?: string): void {
  fs.writeFileSync(lockFilePath(dataDir), raw ?? JSON.stringify(holder))
}

describe('acquireInstanceLock', () => {
  it('creates the lock and records the current process', async () => {
    const result = await acquireInstanceLock(dataDir)
    expect(result.ok).toBe(true)
    expect((await readLockHolder(lockFilePath(dataDir)))?.pid).toBe(process.pid)
  })

  it('creates missing directories on the way', async () => {
    const nested = path.join(dataDir, 'deep', 'deeper')
    expect((await acquireInstanceLock(nested)).ok).toBe(true)
  })

  it('refuses a second instance while the holder is alive', async () => {
    // 父进程在测试跑完之前一直活着，正好当「别人」：既不是我们的 pid，也确实是活的。
    const foreignPid = process.ppid
    expect(foreignPid).not.toBe(process.pid)
    writeLockFile({ pid: foreignPid, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() })

    const second = await acquireInstanceLock(dataDir)
    expect(second).toMatchObject({ ok: false, reason: 'held' })
    // 别人的锁不能动：删掉它等于人为打开双实例的口子。
    expect(fs.existsSync(lockFilePath(dataDir))).toBe(true)
  })

  it('takes over a lock left behind by a dead process', async () => {
    writeLockFile({ pid: DEAD_PID, startedAt: LONG_AGO })

    const result = await acquireInstanceLock(dataDir)
    expect(result.ok).toBe(true)
    expect((await readLockHolder(lockFilePath(dataDir)))?.pid).toBe(process.pid)
  })

  it('takes over a lock whose pid was reused by an unrelated process', async () => {
    // 只看 pid 会被系统坑：锁的主人早就没了，pid 被复用给了一个活着但与此无关的进程。
    // 心跳是唯一能区分这两者的东西——被复用的进程不会替我们续期。
    writeLockFile({ pid: process.ppid, startedAt: LONG_AGO, heartbeatAt: LONG_AGO })

    expect((await acquireInstanceLock(dataDir)).ok).toBe(true)
  })

  it('takes over a fresh lock left behind by this very process', async () => {
    // 锁的主人写的是自己：pid 活着、心跳还新鲜，但它只可能是自己上一次的残影
    // （服务崩溃重启的瞬间，或 pid 被回收后又轮到自己）。不接管就得干等 30 秒心跳过期。
    writeLockFile({ pid: process.pid, startedAt: LONG_AGO, heartbeatAt: new Date().toISOString() })

    const result = await acquireInstanceLock(dataDir)
    expect(result.ok).toBe(true)
    expect((await readLockHolder(lockFilePath(dataDir)))?.pid).toBe(process.pid)
  })


  it('waits out an empty lock file instead of stealing it', async () => {
    // 创建与写入之间必然有一瞬是空文件；这一瞬被当成残留，两个进程就都会以为自己拿到了锁。
    writeLockFile(null, '')

    expect(await acquireInstanceLock(dataDir)).toMatchObject({ ok: false, reason: 'indeterminate' })
  })

  it('takes over an unreadable lock file once it is clearly stale', async () => {
    writeLockFile(null, '{"pid": "not a number"}')
    const past = new Date(Date.now() - 60_000)
    fs.utimesSync(lockFilePath(dataDir), past, past)

    expect((await acquireInstanceLock(dataDir)).ok).toBe(true)
  })

  it('lets go of the lock when released', async () => {
    const result = await acquireInstanceLock(dataDir)
    if (!result.ok) throw new Error('expected the lock')

    await result.lock.release()
    expect(fs.existsSync(lockFilePath(dataDir))).toBe(false)
    expect((await acquireInstanceLock(dataDir)).ok).toBe(true)
  })

  it('survives being released twice', async () => {
    const result = await acquireInstanceLock(dataDir)
    if (!result.ok) throw new Error('expected the lock')

    await result.lock.release()
    await expect(result.lock.release()).resolves.toBeUndefined()
  })
})

describe('releaseInstanceLock', () => {
  it('keeps a lock that belongs to a different process', async () => {
    const foreignPid = process.ppid
    expect(foreignPid).not.toBe(process.pid)
    writeLockFile({ pid: foreignPid, startedAt: new Date().toISOString() })

    await releaseInstanceLock(dataDir)
    expect((await readLockHolder(lockFilePath(dataDir)))?.pid).toBe(foreignPid)
  })
})

describe('refreshHeartbeat', () => {
  it('rewrites the timestamp while we are the holder', async () => {
    writeLockFile({ pid: process.pid, startedAt: LONG_AGO, heartbeatAt: LONG_AGO })

    await refreshHeartbeat(dataDir)

    const holder = await readLockHolder(lockFilePath(dataDir))
    expect(holder?.heartbeatAt).toBeDefined()
    expect(Date.parse(holder!.heartbeatAt!)).toBeGreaterThan(Date.parse(LONG_AGO))
    // 心跳只续期，不改写身份：`startedAt` 是「这个实例什么时候开始的」。
    expect(holder?.startedAt).toBe(LONG_AGO)
  })

  it('leaves someone else lock alone', async () => {
    // 锁可能已经被判残留并被新实例接管；这时再按自己的 pid 覆写，等于凭空造出一个
    // 「我也是持有者」的假象。
    const foreign = { pid: process.ppid, startedAt: LONG_AGO, heartbeatAt: LONG_AGO }
    writeLockFile(foreign)

    await refreshHeartbeat(dataDir)

    expect(await readLockHolder(lockFilePath(dataDir))).toEqual(foreign)
  })

  it('does nothing when the lock file is gone', async () => {
    await expect(refreshHeartbeat(dataDir)).resolves.toBeUndefined()
    expect(fs.existsSync(lockFilePath(dataDir))).toBe(false)
  })
})

describe('isProcessAlive', () => {
  it('recognizes the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('reports a pid that cannot exist as dead', () => {
    expect(isProcessAlive(DEAD_PID)).toBe(false)
  })
})
