import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseFileName } from '@common/database-file'
import { closeDatabases, initDatabases, readDataStorageBytes } from '../database'
import { createProvider } from '@server/database/provider-store'
import { createRequestLog } from '@server/database/request-log-store'
import { storageRoutes } from './routes/operations/storage'
import { mockResponse } from './test-support'

function responseData(res: ServerResponse): { data: { dataBytes: number } } {
  const body = vi.mocked(res.end).mock.calls[0]?.[0]
  return JSON.parse(String(body))
}

let temporaryDirectory: string

/** 观测库的文件名由 `@common/database-file` 推导，测试里也不写死字面量。 */
function dataFilePath(suffix = ''): string {
  return path.join(temporaryDirectory, `${createDatabaseFileName('data')}${suffix}`)
}

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-storage-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('storage usage route', () => {
  it('reports the observability database size', async () => {
    const res = mockResponse()
    await storageRoutes.invoke('/api/storage/usage', res)

    const { data } = responseData(res)
    expect(data.dataBytes).toBeGreaterThan(0)
  })

  it('counts the main file plus the write-ahead log, and nothing else', async () => {
    await createRequestLog({
      logicalModelId: null,
      clientProtocol: null,
      transport: 'http',
      status: 'success',
    })

    // WAL 模式下写入会落进 `-wal`，它此刻同样占着盘，所以必须在统计里。
    expect(fs.existsSync(dataFilePath('-wal'))).toBe(true)
    const expected =
      fs.statSync(dataFilePath()).size + fs.statSync(dataFilePath('-wal')).size
    expect(readDataStorageBytes()).toBe(expected)
  })

  it('does not move when only the config database grows', async () => {
    const before = readDataStorageBytes()
    await createProvider({
      name: 'Storage probe',
      apiKeyReference: 'key_storage_probe',
      timeoutMilliseconds: 30_000,
      enabled: true,
    })
    // 配置库确实长大了……
    expect(fs.statSync(path.join(temporaryDirectory, createDatabaseFileName('config'))).size)
      .toBeGreaterThan(0)
    // ……但观测库的读数不受影响：两个库分开算。
    expect(readDataStorageBytes()).toBe(before)
  })

  it('stops reporting once the databases are closed', async () => {
    expect(readDataStorageBytes()).toBeGreaterThan(0)
    await closeDatabases()
    // 关库时同时忘掉数据目录，避免拿一个已经拆掉的实例的路径去读大小。
    expect(() => readDataStorageBytes()).toThrow('Data directory not initialized')
  })
})
