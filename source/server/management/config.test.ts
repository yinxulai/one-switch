import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initDatabase } from '../database'
import { TEST_DATABASE_FILE_NAME } from '../database/test-support'
import { createProvider, createProviderEndpoint, listProviders, updateProvider } from '@server/database/provider-store'
import { createLogicalModel, listLogicalModels, upsertSchedulingPolicy } from '@server/database/logical-model-store'
import { createProviderModelRoute, listProviderModels } from '@server/database/model-store'
import { updateSettings } from '@server/database/settings-store'
import type { KeychainApi } from '@common/keychain'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { configRoutes } from './config/routes'
import { mockResponse } from './test-support'

function responsePayload(response: ServerResponse): Record<string, unknown> {
  return JSON.parse(String(vi.mocked(response.end).mock.calls[0][0])) as Record<string, unknown>
}

let temporaryDirectory: string
let secretStore: KeychainApi

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-config-'))
  await initDatabase(temporaryDirectory, TEST_DATABASE_FILE_NAME)
  secretStore = { set: vi.fn(async () => undefined), get: vi.fn(async () => null), delete: vi.fn(async () => undefined) }
  configureSecretStore(secretStore)
})

afterEach(async () => {
  await closeDatabase()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('configuration schema', () => {
  it('exports schema version 3 without provider secrets', async () => {
    await createProvider({ name: 'Export Provider', apiKeyReference: 'key_export', timeoutMilliseconds: 30_000 })
    const response = mockResponse()

    await configRoutes.invoke('/api/config/export', response, {})

    const payload = responsePayload(response) as { success: boolean; data: { config: { schemaVersion: number; providers: Array<{ apiKeyPlaceholder: string }> } } }
    expect(payload.success).toBe(true)
    expect(payload.data.config.schemaVersion).toBe(3)
    expect(payload.data.config.providers).toEqual([
      expect.objectContaining({ apiKeyPlaceholder: '***' }),
    ])
  })

  it('rejects the removed version field during import', async () => {
    const response = mockResponse()

    await configRoutes.invoke('/api/config/import', response, {
      config: { version: 3 },
      mode: 'merge',
    })

    expect(response.statusCode).toBe(400)
    expect(responsePayload(response)).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' })
  })

  it('imports providers, logical models, provider models, and scheduling policies', async () => {
    const response = mockResponse()
    await configRoutes.invoke('/api/config/import', response, {
      mode: 'merge',
      config: {
        schemaVersion: 3,
        exportedAt: Date.now(),
        settings: { listenPort: 9400 },
        providers: [{ id: 'provider-source', name: 'Imported Provider', apiKey: 'secret-value', endpoints: { 'openai-completions': 'https://example.com/v1/chat/completions' } }],
        logicalModels: [{ id: 'logical-source', name: 'Imported Model', description: 'demo' }],
        providerModels: [{ id: 'model-source', providerId: 'provider-source', modelName: 'upstream-model', endpoints: [{ protocol: 'openai-completions', url: 'https://example.com/v1/chat/completions' }] }],
        schedulingPolicies: [{ logicalModelId: 'logical-source', providerModelId: 'model-source', priority: 1 }],
      },
    })

    expect(responsePayload(response)).toMatchObject({ success: true, data: { imported: { providers: 1, logicalModels: 1, providerModels: 1 } } })
    expect(secretStore.set).toHaveBeenCalledWith(expect.any(String), 'secret-value')
    expect(await listProviders()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Imported Provider' })]))
    expect(await listLogicalModels()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Imported Model' })]))
    expect(await listProviderModels()).toEqual(expect.arrayContaining([expect.objectContaining({ modelName: 'upstream-model' })]))
  })

  it('replaces entities omitted from the imported configuration', async () => {
    const oldProviderResponse = mockResponse()
    await configRoutes.invoke('/api/config/import', oldProviderResponse, {
      config: { schemaVersion: 3, exportedAt: Date.now(), providers: [{ name: 'Old Provider' }] },
    })
    const response = mockResponse()
    await configRoutes.invoke('/api/config/import', response, {
      mode: 'replace',
      config: { schemaVersion: 3, exportedAt: Date.now(), providers: [{ name: 'New Provider' }] },
    })

    expect(await listProviders()).toEqual([expect.objectContaining({ name: 'New Provider' })])
  })

  it('round-trips provider description through export and import', async () => {
    await createProvider({ name: 'Described Provider', description: '华东区主账号', apiKeyReference: 'key_desc', timeoutMilliseconds: 30_000 })
    const exportResponse = mockResponse()
    await configRoutes.invoke('/api/config/export', exportResponse, {})
    const exported = responsePayload(exportResponse) as { data: { config: { providers: Array<{ name: string; description?: string }> } } }
    expect(exported.data.config.providers).toEqual([
      expect.objectContaining({ name: 'Described Provider', description: '华东区主账号' }),
    ])

    // 导入到全新环境后描述应保留，而不是被重置为空字符串。
    const existing = await listProviders()
    await updateProvider(existing[0].id, { description: '' })
    const importResponse = mockResponse()
    await configRoutes.invoke('/api/config/import', importResponse, {
      mode: 'merge',
      config: { schemaVersion: 3, exportedAt: Date.now(), providers: [{ name: 'Described Provider', description: '华东区主账号' }] },
    })
    expect(await listProviders()).toEqual([expect.objectContaining({ name: 'Described Provider', description: '华东区主账号' })])
  })

  it('keeps routes whose provider ids were remapped when importing in replace mode', async () => {
    const provider = await createProvider({ name: 'Remapped Provider', apiKeyReference: 'key_remap', timeoutMilliseconds: 30_000 })
    await createProviderModelRoute({ providerId: provider.id, modelName: 'remapped-model', priority: 0 })

    const response = mockResponse()
    await configRoutes.invoke('/api/config/import', response, {
      mode: 'replace',
      config: {
        schemaVersion: 3,
        exportedAt: Date.now(),
        providers: [{ id: 'source-provider-id', name: 'Remapped Provider' }],
        logicalModels: [{ id: 'source-logical-id', name: 'default' }],
        providerModels: [{ id: 'source-model-id', providerId: 'source-provider-id', modelName: 'remapped-model' }],
        schedulingPolicies: [{ logicalModelId: 'source-logical-id', providerModelId: 'source-model-id', priority: 3 }],
      },
    })

    // providerId 被重映射到本库的真实 ID，路由应被保留而不是误删。
    expect(await listProviderModels()).toEqual([
      expect.objectContaining({ providerId: provider.id, modelName: 'remapped-model' }),
    ])
  })
})

describe('configuration export completeness', () => {
  interface ExportedConfig {
    schemaVersion: number
    settings: { listenPort: number; logRetentionDays: number; captureRequestContent: boolean; listenHost: string }
    providers: Array<{ id: string; name: string; description: string; timeoutMilliseconds: number; enabled: boolean; endpoints: Record<string, string> }>
    logicalModels: Array<{ id: string; name: string; description: string; enabled: boolean }>
    providerModels: Array<{
      id: string
      providerId: string
      modelName: string
      enabled: boolean
      endpoints: Array<{ protocol: string; url: string; enabled: boolean; conversions: Array<{ clientProtocol: string; enabled: boolean }> }>
    }>
    schedulingPolicies: Array<{ logicalModelId: string; providerModelId: string; strategy: string; priority: number; weight: number; enabled: boolean }>
  }

  async function exportConfigDocument(): Promise<ExportedConfig> {
    const response = mockResponse()
    await configRoutes.invoke('/api/config/export', response, {})
    const payload = responsePayload(response) as { success: boolean; data: { config: ExportedConfig } }
    expect(payload.success).toBe(true)
    return payload.data.config
  }

  it('exports settings, enabled provider endpoints, logical models, provider models and scheduling policies', async () => {
    const provider = await createProvider({ name: 'Full Provider', description: '完整导出', apiKeyReference: 'key_full', timeoutMilliseconds: 12_345 })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://example.com/v1/chat/completions' })
    // 被禁用的端点不应出现在导出结果里。
    await createProviderEndpoint({ providerId: provider.id, protocol: 'anthropic-messages', url: 'https://example.com/v1/messages', enabled: false })

    await createLogicalModel({ id: 'logical_full', name: '完整模型', description: '逻辑模型' })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'full-model',
      priority: 2,
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: true,
      }],
    })
    await upsertSchedulingPolicy({ logicalModelId: 'logical_full', providerModelId: route.id, priority: 5, weight: 7, enabled: false })
    await updateSettings({ listenPort: 9_401, captureRequestContent: true, logRetentionDays: 3 })

    const config = await exportConfigDocument()

    expect(config.settings).toMatchObject({
      listenPort: 9_401,
      captureRequestContent: true,
      logRetentionDays: 3,
    })
    expect(config.settings.listenHost).toEqual(expect.any(String))

    expect(config.providers).toEqual([
      expect.objectContaining({
        id: provider.id,
        name: 'Full Provider',
        description: '完整导出',
        timeoutMilliseconds: 12_345,
        enabled: true,
        // 只导出启用的端点。
        endpoints: { 'openai-completions': 'https://example.com/v1/chat/completions' },
      }),
    ])

    // 初始化时会自动创建 default 逻辑模型，这里只校验导入的这条。
    expect(config.logicalModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'logical_full', name: '完整模型', description: '逻辑模型', enabled: true }),
    ]))

    expect(config.providerModels).toEqual([
      expect.objectContaining({
        id: route.id,
        providerId: provider.id,
        modelName: 'full-model',
        enabled: true,
        endpoints: [
          expect.objectContaining({
            protocol: 'openai-completions',
            url: 'https://example.com/v1/chat/completions',
            enabled: true,
            // 开启协议转换后应导出该端点支持的全部客户端协议。
            conversions: expect.arrayContaining([
              expect.objectContaining({ clientProtocol: 'anthropic-messages', enabled: true }),
              expect.objectContaining({ clientProtocol: 'openai-responses', enabled: true }),
            ]),
          }),
        ],
      }),
    ])

    expect(config.schedulingPolicies).toEqual([
      expect.objectContaining({
        logicalModelId: 'logical_full',
        providerModelId: route.id,
        strategy: 'priority',
        priority: 5,
        weight: 7,
        enabled: false,
      }),
    ])
  })

  it('round-trips the exported document back through import', async () => {
    const provider = await createProvider({ name: 'Round Trip Provider', description: '往返', apiKeyReference: 'key_round', timeoutMilliseconds: 20_000 })
    await createProviderEndpoint({ providerId: provider.id, protocol: 'openai-completions', url: 'https://example.com/v1/chat/completions' })
    await createLogicalModel({ id: 'logical_round', name: '往返模型' })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'round-model',
      priority: 1,
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: false,
      }],
    })
    await upsertSchedulingPolicy({ logicalModelId: 'logical_round', providerModelId: route.id, priority: 4 })
    await updateSettings({ captureRequestContent: true, logRetentionDays: 5 })

    const exported = await exportConfigDocument()

    // 导入到全新数据库后应恢复关键配置，而不是静默丢字段。
    const importResponse = mockResponse()
    await configRoutes.invoke('/api/config/import', importResponse, {
      mode: 'replace',
      config: { ...exported, providers: exported.providers.map(item => ({ ...item, apiKey: 'round-secret' })) },
    })
    expect(responsePayload(importResponse)).toMatchObject({ success: true })

    const [importedProvider] = await listProviders()
    expect(importedProvider).toMatchObject({ name: 'Round Trip Provider', description: '往返', timeoutMilliseconds: 20_000 })
    const importedLogicalModel = (await listLogicalModels()).find(model => model.id === 'logical_round')
    expect(importedLogicalModel).toMatchObject({ id: 'logical_round', name: '往返模型' })
    const [importedModel] = await listProviderModels()
    expect(importedModel).toMatchObject({
      providerId: importedProvider.id,
      modelName: 'round-model',
      endpoints: [expect.objectContaining({ protocol: 'openai-completions', url: 'https://example.com/v1/chat/completions' })],
    })
    expect(await listProviderModels()).toHaveLength(1)
  })
})
