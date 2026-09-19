import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from '../database'
import { createProvider } from '@server/database/provider-store'
import { createLogicalModel } from '@server/database/logical-model-store'
import { providerModelRoutes } from './routes/catalog/provider-models'
import { mockResponse } from './test-support'

function responseData(response: ServerResponse): Record<string, unknown> {
  const body = vi.mocked(response.end).mock.calls[0]?.[0]
  return JSON.parse(String(body)) as Record<string, unknown>
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-provider-models-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('provider model routes', () => {
  it('creates a model and updates its scheduling policy', async () => {
    const provider = await createProvider({ name: 'Provider Model Provider', apiKeyReference: 'key_provider_model', timeoutMilliseconds: 15_000, enabled: true })
    const logicalModel = await createLogicalModel({ id: 'routing-model', name: 'routing-model', description: 'route tests' })

    const createRes = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/create', createRes, {
      providerId: provider.id,
      modelName: 'super-fast-model',
      logicalModelId: logicalModel.id,
      priority: 7,
      endpoints: [{ protocol: 'openai-responses', endpointUrl: 'https://example.com/v1/responses', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const created = responseData(createRes).data as { id: string }
    expect(created.id).toMatch(/^model_/)

    const listPoliciesRes = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/list', listPoliciesRes, { logicalModelId: logicalModel.id })
    expect(responseData(listPoliciesRes).data).toEqual(expect.arrayContaining([expect.objectContaining({ providerModelId: created.id, logicalModelId: logicalModel.id, priority: 7 })]))

    const updateRes = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/update', updateRes, {
      logicalModelId: logicalModel.id,
      providerModelId: created.id,
      priority: 11,
      weight: 80,
      enabled: true,
    })
    expect(responseData(updateRes).data).toMatchObject({ logicalModelId: logicalModel.id, providerModelId: created.id, priority: 11, weight: 80 })

    const deleteRes = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/delete', deleteRes, { logicalModelId: logicalModel.id, providerModelId: created.id })
    expect(responseData(deleteRes).data).toMatchObject({ logicalModelId: logicalModel.id, providerModelId: created.id })
  })
})

async function createModelWithEndpoint(providerId: string, modelName: string, logicalModelId = 'default'): Promise<{ id: string }> {
  const response = mockResponse()
  await providerModelRoutes.invoke('/api/provider-model/create', response, {
    providerId,
    modelName,
    logicalModelId,
    endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions' }],
  })
  return responseData(response).data as { id: string }
}

describe('provider model CRUD routes', () => {
  it('lists models, including the soft-deleted ones when asked', async () => {
    const provider = await createProvider({ name: 'Crud Provider', apiKeyReference: 'key_crud', enabled: true })
    const model = await createModelWithEndpoint(provider.id, 'crud-model')

    const alive = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/list', alive, {})
    expect(responseData(alive).data).toEqual([expect.objectContaining({ id: model.id })])

    const remove = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/delete', remove, { id: model.id })

    const afterDelete = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/list', afterDelete, {})
    expect(responseData(afterDelete).data).toEqual([])

    const withDeleted = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/list', withDeleted, { includeDeleted: true })
    expect(responseData(withDeleted).data).toEqual([expect.objectContaining({ id: model.id })])
  })

  it('lists the models bound to a logical model', async () => {
    const provider = await createProvider({ name: 'Logical Provider', apiKeyReference: 'key_logical', enabled: true })
    const logicalModel = await createLogicalModel({ id: 'logical-list', name: 'logical-list', description: '' })
    const model = await createModelWithEndpoint(provider.id, 'logical-model', logicalModel.id)

    const res = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/list-by-logical-model', res, { logicalModelId: logicalModel.id })
    expect(responseData(res).data).toEqual([expect.objectContaining({ id: model.id })])
  })

  it('reads a single model and throws for an unknown id', async () => {
    const provider = await createProvider({ name: 'Read Provider', apiKeyReference: 'key_read', enabled: true })
    const model = await createModelWithEndpoint(provider.id, 'read-model')

    const found = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/get', found, { id: model.id })
    expect(responseData(found).data).toMatchObject({ id: model.id })

    await expect(providerModelRoutes.invoke('/api/provider-model/get', mockResponse(), { id: 'model_missing' }))
      .rejects.toThrow(/provider model not found/)
  })

  it('merges partial updates and rewrites the scheduling policy when both fields are given', async () => {
    const provider = await createProvider({ name: 'Update Provider', apiKeyReference: 'key_update', enabled: true })
    const logicalModel = await createLogicalModel({ id: 'logical-update', name: 'logical-update', description: '' })
    const model = await createModelWithEndpoint(provider.id, 'update-model', logicalModel.id)

    const res = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/update', res, {
      id: model.id,
      modelName: 'renamed-model',
      enabled: true,
      logicalModelId: logicalModel.id,
      priority: 42,
    })
    expect(responseData(res).data).toMatchObject({ id: model.id, modelName: 'renamed-model', enabled: true })

    const policies = mockResponse()
    await providerModelRoutes.invoke('/api/scheduling-policy/list', policies, { logicalModelId: logicalModel.id })
    expect(responseData(policies).data).toEqual([
      expect.objectContaining({ providerModelId: model.id, logicalModelId: logicalModel.id, priority: 42 }),
    ])
  })

  it('leaves the scheduling policy untouched when only a logical model id is supplied', async () => {
    const provider = await createProvider({ name: 'Partial Provider', apiKeyReference: 'key_partial', enabled: true })
    const logicalModel = await createLogicalModel({ id: 'logical-partial', name: 'logical-partial', description: '' })
    const model = await createModelWithEndpoint(provider.id, 'partial-model', logicalModel.id)

    const res = mockResponse()
    await providerModelRoutes.invoke('/api/provider-model/update', res, { id: model.id, logicalModelId: logicalModel.id, modelName: 'still-partial' })
    expect(responseData(res).data).toMatchObject({ id: model.id, modelName: 'still-partial' })
  })
})
