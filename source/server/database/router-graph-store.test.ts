import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultPolicyGraph, isSameGraph } from '@common/router/presets'
import type { RuntimeLogicalModel, WorkflowGraph } from '@common/router/types'
import { closeDatabase, initDatabase } from './index'
import { TEST_DATABASE_FILE_NAME } from './test-support'
import { listLogicalModels } from './logical-model-store'
import {
  MAX_ROUTER_GRAPH_VERSIONS,
  listRouterGraphVersions,
  readRouterGraphSnapshot,
  readRouterGraphVersion,
  resolveRouterGraph,
  saveRouterGraphVersion,
} from './router-graph-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await closeDatabase()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

async function initTemporaryDatabase(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-router-graph-'))
  temporaryDirectories.push(directory)
  await initDatabase(directory, TEST_DATABASE_FILE_NAME)
}

async function createModels(): Promise<RuntimeLogicalModel[]> {
  // 内建默认逻辑模型由 `initDatabase` 落库，这里不重复创建它（`logical_models.name` 上是唯一索引）。
  const seeded = await listLogicalModels()
  return seeded.map(model => ({ id: model.id, name: model.name, enabled: model.enabled }))
}

/** 造一张与基准图不同的图：只改节点名，结构仍然合法。 */
function graphWithMarker(marker: string): WorkflowGraph {
  const base = createDefaultPolicyGraph([])
  return { ...base, nodes: base.nodes.map(node => ({ ...node, name: `${marker}${node.name}` })) }
}

describe('router graph store', () => {
  it('falls back to the built-in default policy when nothing has been saved', async () => {
    await initTemporaryDatabase()
    const models = await createModels()

    const snapshot = await resolveRouterGraph()

    expect(snapshot.version).toBe(0)
    expect(snapshot.savedAt).toBe(0)
    expect(isSameGraph(snapshot.graph, createDefaultPolicyGraph(models))).toBe(true)
    expect(await readRouterGraphSnapshot()).toBeNull()
    expect(await listRouterGraphVersions()).toEqual([])
  })

  it('saves a version, reads it back, and keeps version numbers monotonic', async () => {
    await initTemporaryDatabase()
    const first = graphWithMarker('v1-')
    const second = graphWithMarker('v2-')

    const savedFirst = await saveRouterGraphVersion(first, '第一版')
    const savedSecond = await saveRouterGraphVersion(second, '第二版')

    expect(savedFirst).toMatchObject({ version: 1, name: '第一版', created: true })
    expect(savedSecond).toMatchObject({ version: 2, name: '第二版', created: true })
    expect(savedFirst.nodeCount).toBe(first.nodes.length)

    const snapshot = await readRouterGraphSnapshot()
    expect(snapshot?.version).toBe(2)
    expect(snapshot?.graph && isSameGraph(snapshot.graph, second)).toBe(true)

    const restored = await readRouterGraphVersion(1)
    expect(restored?.version).toBe(1)
    expect(restored?.graph && isSameGraph(restored.graph, first)).toBe(true)
    expect(await readRouterGraphVersion(9)).toBeNull()

    expect((await resolveRouterGraph()).version).toBe(2)
  })

  it('does not create a version when the content equals the latest one', async () => {
    await initTemporaryDatabase()
    const graph = graphWithMarker('same-')

    await saveRouterGraphVersion(graph, undefined)
    const repeated = await saveRouterGraphVersion(graph, undefined)

    expect(repeated).toMatchObject({ version: 1, created: false })
    expect(await listRouterGraphVersions()).toHaveLength(1)
  })

  it('archives the oldest versions beyond the retention limit', async () => {
    await initTemporaryDatabase()

    for (let index = 1; index <= MAX_ROUTER_GRAPH_VERSIONS + 3; index += 1) {
      await saveRouterGraphVersion(graphWithMarker(`v${index}-`), undefined)
    }

    const versions = await listRouterGraphVersions()
    expect(versions).toHaveLength(MAX_ROUTER_GRAPH_VERSIONS)
    // 新的在前往前，最旧的三版已经不再出现在列表里，也读不回来。
    expect(versions[0].version).toBe(MAX_ROUTER_GRAPH_VERSIONS + 3)
    expect(await readRouterGraphVersion(1)).toBeNull()
    expect(await readRouterGraphVersion(4)).not.toBeNull()
  })

  it('skips stored rows whose definition is not a valid graph', async () => {
    await initTemporaryDatabase()
    const graph = graphWithMarker('ok-')
    await saveRouterGraphVersion(graph, undefined)

    const { createWorkflow } = await import('./workflow-store')
    await createWorkflow({ type: 'router', version: 2, name: '损坏的版本', definition: { version: 1, nodes: 'not-an-array' } })

    const versions = await listRouterGraphVersions()
    expect(versions.map(version => version.version)).toEqual([1])
    // 最新一版损坏时不能把整个读取拖下水：退回上一版可解析的图。
    expect((await readRouterGraphSnapshot())?.version).toBe(1)
  })
})
