import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from './index'
import { createWorkflow, getLatestWorkflow, getWorkflow, listWorkflows, updateWorkflow } from './workflow-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await closeDatabase()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-workflow-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('workflow store', () => {
  it('creates versioned workflow records and resolves the latest record by type', async () => {
    await initDatabase(createTemporaryDirectory())

    const first = await createWorkflow({
      type: 'router',
      version: 1,
      name: 'Router v1',
      definition: { nodes: [] },
    })
    const second = await createWorkflow({
      type: 'router',
      version: 2,
      name: 'Router v2',
      definition: { nodes: [{ id: 'input' }] },
    })

    expect(await getWorkflow('router', 1)).toMatchObject({ id: first.id, type: 'router', version: 1, name: 'Router v1', definition: { nodes: [] } })
    expect(await getWorkflow('router', 2)).toMatchObject({ id: second.id, type: 'router', version: 2, name: 'Router v2', definition: { nodes: [{ id: 'input' }] } })
    expect(await getLatestWorkflow('router')).toMatchObject({ id: second.id, version: 2 })
    expect(await listWorkflows()).toHaveLength(2)
  })

  it('updates workflow metadata without changing the version identity', async () => {
    await initDatabase(createTemporaryDirectory())

    const workflow = await createWorkflow({
      type: 'router',
      version: 1,
      name: 'Router draft',
      definition: { nodes: [] },
    })

    const updated = await updateWorkflow(workflow.id, {
      name: 'Router published',
      definition: { nodes: [{ id: 'input' }, { id: 'output' }] },
    })

    expect(updated).toMatchObject({ id: workflow.id, type: 'router', version: 1, name: 'Router published', definition: { nodes: [{ id: 'input' }, { id: 'output' }] } })
    expect(await getWorkflow('router', 1)).toMatchObject({ name: 'Router published' })
  })
})
