import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeFileState } from './runtime-state'
import {
  RUNTIME_FILE_NAME,
  isProcessAlive,
  readRuntimeState,
  removeRuntimeState,
  runtimeFilePath,
  writeRuntimeState,
} from './runtime-state'

let dataDirectory: string

function createState(overrides: Partial<RuntimeFileState> = {}): RuntimeFileState {
  return {
    pid: 4242,
    appVersion: '1.1.0-beta.2',
    environment: 'production',
    managementHost: '127.0.0.1',
    managementPort: 9301,
    proxyHost: '127.0.0.1',
    proxyPort: 9300,
    webUrl: 'http://127.0.0.1:9301',
    startedAt: '2026-09-11T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'osw-cli-runtime-'))
})

afterEach(() => {
  fs.rmSync(dataDirectory, { recursive: true, force: true })
})

describe('runtime state file', () => {
  it('round-trips a state', async () => {
    const state = createState()
    await writeRuntimeState(dataDirectory, state)

    expect(await readRuntimeState(dataDirectory)).toEqual(state)
  })

  it('creates the data directory when it does not exist yet', async () => {
    const nested = path.join(dataDirectory, 'missing', 'deeper')
    await writeRuntimeState(nested, createState())

    expect(await readRuntimeState(nested)).not.toBeNull()
  })

  it('leaves no temporary file behind', async () => {
    await writeRuntimeState(dataDirectory, createState())

    // 原子写用的是 `runtime.json.tmp`，写盘后必须改名走人，否则 `status` 会看到残留。
    expect(fs.readdirSync(dataDirectory).filter(name => name.endsWith('.tmp'))).toHaveLength(0)
  })

  it('treats a missing file as "not running"', async () => {
    expect(await readRuntimeState(dataDirectory)).toBeNull()
    expect(await removeRuntimeState(dataDirectory)).toBeUndefined()
  })

  it('treats unreadable content as "not running"', async () => {
    for (const raw of ['{', 'null', '[]', '"text"', '{"pid": 1}', JSON.stringify({ ...createState(), webUrl: 7 })]) {
      fs.writeFileSync(runtimeFilePath(dataDirectory), raw)
      expect(await readRuntimeState(dataDirectory)).toBeNull()
    }
  })

  it('accepts an explicit null web url', async () => {
    await writeRuntimeState(dataDirectory, createState({ webUrl: null }))

    expect((await readRuntimeState(dataDirectory))?.webUrl).toBeNull()
  })

  it('writes the file with owner-only permissions', async () => {
    await writeRuntimeState(dataDirectory, createState())

    // 里面写着本机管理面（回环地址与端口）。Windows 上 POSIX 权限位不可靠，跳过。
    if (process.platform !== 'win32') {
      expect(fs.statSync(runtimeFilePath(dataDirectory)).mode & 0o777).toBe(0o600)
    }
  })

  it('removes the file it wrote', async () => {
    await writeRuntimeState(dataDirectory, createState())
    await removeRuntimeState(dataDirectory)

    expect(fs.existsSync(path.join(dataDirectory, RUNTIME_FILE_NAME))).toBe(false)
  })
})

describe('isProcessAlive', () => {
  it('reports the current process as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('reports a pid that cannot exist as dead', () => {
    // 0 与负数会被 `kill` 当成进程组/无效参数，永远不可能对应本机的一个 Node 进程。
    expect(isProcessAlive(2_147_483_646)).toBe(false)
  })
})
