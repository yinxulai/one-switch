import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabases, initDatabases } from '../database'
import { createProvider } from '@server/database/provider-store'
import { createProviderModelRoute } from '@server/database/model-store'
import { relationRoutes } from './routes/relations/relations'
import { mockResponse } from './test-support'

function responseData(response: ServerResponse): unknown {
  const raw = vi.mocked(response.end).mock.calls[0][0] as string
  return JSON.parse(raw).data
}

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-relations-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('relation management', () => {
  it('creates and reads provider endpoint, model endpoint, and converter relations', async () => {
    const provider = await createProvider({ name: 'Relations', apiKeyReference: 'key_relations', timeoutMilliseconds: 30_000 })
    const model = await createProviderModelRoute({ providerId: provider.id, modelName: 'relations-model', priority: 0 })
    const endpointResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-endpoint/create', endpointResponse, {
      providerId: provider.id,
      protocol: 'openai-responses',
      url: 'https://example.com/v1/responses',
    })
    const endpoint = responseData(endpointResponse) as { id: string }
    const bindingResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-model-endpoint/create', bindingResponse, {
      providerModelId: model.id,
      providerEndpointId: endpoint.id,
    })
    const binding = responseData(bindingResponse) as { id: string }
    const converterResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/protocol-converter/create', converterResponse, {
      providerModelEndpointId: binding.id,
      clientProtocol: 'anthropic-messages',
    })
    const converter = responseData(converterResponse) as { id: string; enabled: boolean }
    const listResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/protocol-converter/list', listResponse, {
      providerModelEndpointId: binding.id,
    })

    expect(converter).toMatchObject({ id: expect.stringMatching(/^conv_/), enabled: true })
    expect(responseData(listResponse)).toEqual([expect.objectContaining({ id: converter.id, clientProtocol: 'anthropic-messages' })])
  })
})

async function createProviderAndModel(suffix: string): Promise<{ providerId: string; modelId: string }> {
  const provider = await createProvider({ name: `Relations ${suffix}`, apiKeyReference: `key_${suffix}`, timeoutMilliseconds: 30_000 })
  const model = await createProviderModelRoute({ providerId: provider.id, modelName: `relations-${suffix}`, priority: 0 })
  return { providerId: provider.id, modelId: model.id }
}

describe('provider settings', () => {
  it('upserts, reads back, lists, then deletes', async () => {
    const { providerId } = await createProviderAndModel('setting')

    const upsert = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-setting/upsert', upsert, {
      providerId,
      key: 'region',
      value: 'cn-hangzhou',
      valueType: 'string',
    })
    expect(responseData(upsert)).toMatchObject({ providerId, key: 'region', value: 'cn-hangzhou', valueType: 'string' })

    const get = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-setting/get', get, { providerId, key: 'region' })
    expect(responseData(get)).toMatchObject({ key: 'region', value: 'cn-hangzhou' })

    const list = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-setting/list', list, { providerId })
    // 建供应商时已经自带若干默认设置（超时、密钥引用），这里只要求新增那条在里面
    expect(responseData(list)).toContainEqual(expect.objectContaining({ key: 'region', value: 'cn-hangzhou' }))

    const remove = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-setting/delete', remove, { providerId, key: 'region' })
    expect(responseData(remove)).toEqual({ providerId, key: 'region' })

    const missing = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-setting/get', missing, { providerId, key: 'region' })
    expect(missing.statusCode).toBe(404)
  })
})

describe('provider endpoint routes', () => {
  it('creates, reads, updates and deletes', async () => {
    const { providerId } = await createProviderAndModel('endpoint')

    const create = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-endpoint/create', create, {
      providerId,
      protocol: 'openai-completions',
      url: 'https://example.com/v1/chat/completions',
    })
    const endpoint = responseData(create) as { id: string; enabled: boolean }
    expect(endpoint).toMatchObject({ enabled: true, protocol: 'openai-completions' })

    const get = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-endpoint/get', get, { id: endpoint.id })
    expect(responseData(get)).toMatchObject({ id: endpoint.id })

    const update = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-endpoint/update', update, {
      id: endpoint.id,
      url: 'https://example.com/v2/chat/completions',
      enabled: false,
    })
    expect(responseData(update)).toMatchObject({ id: endpoint.id, enabled: false, url: 'https://example.com/v2/chat/completions' })

    const list = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-endpoint/list', list, { providerId })
    expect(responseData(list)).toEqual([expect.objectContaining({ id: endpoint.id })])

    const remove = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-endpoint/delete', remove, { id: endpoint.id })
    expect(responseData(remove)).toEqual({ id: endpoint.id })

    const gone = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-endpoint/get', gone, { id: endpoint.id })
    expect(gone.statusCode).toBe(404)
  })
})

describe('provider model endpoint routes', () => {
  it('creates with an explicit override url, updates and deletes', async () => {
    const { providerId, modelId } = await createProviderAndModel('model-endpoint')
    const endpointResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-endpoint/create', endpointResponse, {
      providerId,
      protocol: 'anthropic-messages',
      url: 'https://example.com/v1/messages',
    })
    const endpoint = responseData(endpointResponse) as { id: string }

    const create = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-model-endpoint/create', create, {
      providerModelId: modelId,
      providerEndpointId: endpoint.id,
      url: 'https://override.example.com/v1/messages',
    })
    const binding = responseData(create) as { id: string; url: string }
    expect(binding).toMatchObject({ enabled: true, url: 'https://override.example.com/v1/messages' })

    const get = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-model-endpoint/get', get, { id: binding.id })
    expect(responseData(get)).toMatchObject({ id: binding.id })

    const update = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-model-endpoint/update', update, { id: binding.id, enabled: false })
    expect(responseData(update)).toMatchObject({ id: binding.id, enabled: false })

    const list = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-model-endpoint/list', list, { providerModelId: modelId })
    expect(responseData(list)).toEqual([expect.objectContaining({ id: binding.id })])

    const remove = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-model-endpoint/delete', remove, { id: binding.id })
    expect(responseData(remove)).toEqual({ id: binding.id })

    const gone = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-model-endpoint/get', gone, { id: binding.id })
    expect(gone.statusCode).toBe(404)
  })
})

describe('protocol converter routes', () => {
  it('creates, updates the client protocol and deletes', async () => {
    const { providerId, modelId } = await createProviderAndModel('converter')
    const endpointResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-endpoint/create', endpointResponse, {
      providerId,
      protocol: 'openai-completions',
      url: 'https://example.com/v1/chat/completions',
    })
    const endpoint = responseData(endpointResponse) as { id: string }
    const bindingResponse = mockResponse()
    await relationRoutes.invoke('/api/relation/provider-model-endpoint/create', bindingResponse, {
      providerModelId: modelId,
      providerEndpointId: endpoint.id,
    })
    const binding = responseData(bindingResponse) as { id: string }

    const create = mockResponse()
    await relationRoutes.invoke('/api/relation/protocol-converter/create', create, {
      providerModelEndpointId: binding.id,
      clientProtocol: 'anthropic-messages',
    })
    const converter = responseData(create) as { id: string; enabled: boolean }
    expect(converter.enabled).toBe(true)

    const get = mockResponse()
    await relationRoutes.invoke('/api/relation/protocol-converter/get', get, { id: converter.id })
    expect(responseData(get)).toMatchObject({ id: converter.id })

    const update = mockResponse()
    await relationRoutes.invoke('/api/relation/protocol-converter/update', update, {
      id: converter.id,
      clientProtocol: 'openai-responses',
      enabled: false,
    })
    expect(responseData(update)).toMatchObject({ id: converter.id, clientProtocol: 'openai-responses', enabled: false })

    const remove = mockResponse()
    await relationRoutes.invoke('/api/relation/protocol-converter/delete', remove, { id: converter.id })
    expect(responseData(remove)).toEqual({ id: converter.id })

    const gone = mockResponse()
    await relationRoutes.invoke('/api/relation/protocol-converter/get', gone, { id: converter.id })
    expect(gone.statusCode).toBe(404)
  })
})
