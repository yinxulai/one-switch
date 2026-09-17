import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabases, initDatabases } from './index'
import {
  createProviderModelEndpoint,
  createProviderModelRoute,
  createProtocolConverter,
  getProviderModel,
  getProviderModelRoute,
  listProviderModelRoutesByProvider,
  listProviderModelsForLogicalModel,
  updateProviderModelEndpoint,
  updateProviderModelRoute,
} from './model-store'
import { createLogicalModel, upsertSchedulingPolicy } from './logical-model-store'
import { createProvider, createProviderEndpoint, listProviderEndpoints } from './provider-store'

let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-model-store-'))
  await initDatabases(temporaryDirectory)
})

afterEach(async () => {
  await closeDatabases()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('model store', () => {
  it('creates provider model routes, endpoints and protocol converters through the real database', async () => {
    const provider = await createProvider({
      name: 'Model Provider',
      apiKeyReference: 'key_model_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'gpt-4o-mini',
      priority: 5,
      endpoints: [{
        protocol: 'openai-completions',
        endpointUrl: 'https://example.com/v1/chat/completions',
        customAuthHeader: null,
        protocolConversionEnabled: true,
      }],
    })

    const persisted = await getProviderModel(route.id)
    expect(persisted).toMatchObject({
      id: route.id,
      providerId: provider.id,
      modelName: 'gpt-4o-mini',
      enabled: true,
    })
    expect(persisted?.endpoints[0]).toMatchObject({
      protocol: 'openai-completions',
      providerModelId: route.id,
      enabled: true,
    })
    expect(persisted?.endpoints[0].conversions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientProtocol: 'openai-responses' }),
      ]),
    )

    const extraEndpoint = await createProviderModelEndpoint({
      providerModelId: route.id,
      providerEndpointId: (await createProviderEndpoint({
        providerId: provider.id,
        protocol: 'openai-responses',
        url: 'https://example.com/v1/responses',
        enabled: true,
      })).id,
      url: 'https://example.com/custom',
      enabled: true,
    })

    await updateProviderModelEndpoint(extraEndpoint.id, { url: 'https://example.com/custom-updated', enabled: true })
    const updatedEndpoint = await getProviderModel(route.id)
    expect(updatedEndpoint?.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: extraEndpoint.id, url: 'https://example.com/custom-updated', enabled: true }),
    ]))

    const converter = await createProtocolConverter({
      providerModelEndpointId: extraEndpoint.id,
      clientProtocol: 'openai-responses',
      enabled: true,
    })
    expect(converter).toMatchObject({ providerModelEndpointId: extraEndpoint.id, clientProtocol: 'openai-responses', enabled: true })

    const logicalModel = await createLogicalModel({ id: 'model-routing', name: 'model-routing', description: 'route test' })
    await upsertSchedulingPolicy({
      logicalModelId: logicalModel.id,
      providerModelId: route.id,
      priority: 1,
      weight: 40,
      enabled: true,
    })

    expect(await listProviderModelsForLogicalModel(logicalModel.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: route.id, modelName: 'gpt-4o-mini', priority: 1 }),
    ]))
    expect(await listProviderModelRoutesByProvider(provider.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: route.id, modelName: 'gpt-4o-mini' }),
    ]))
  })

  // 回归：模型与供应商两层都没地址时必须**直接报错**，不能编一个地址顶上——编出来的地址会显示成
  // 「用户自己配的地址」，请求也真的会打到那里去。
  it('refuses to save a model whose protocol has no address anywhere', async () => {
    const provider = await createProvider({
      name: 'Addressless Provider',
      apiKeyReference: 'key_addressless_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })

    await expect(createProviderModelRoute({
      providerId: provider.id,
      modelName: 'addressless-model',
      priority: 1,
      endpoints: [{ protocol: 'openai-responses', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false }],
    })).rejects.toMatchObject({
      code: 'ENDPOINT_URL_MISSING',
      statusCode: 400,
      // 报错要说清「哪个供应商的哪个协议」——那才是用户能照着改的那一步。
      details: { providerName: 'Addressless Provider', protocols: 'OpenAI Responses' },
    })

    // 报错发生在事务里：模型、端点、绑定一个都不该留下。
    expect(await listProviderModelRoutesByProvider(provider.id)).toEqual([])
    expect(await listProviderEndpoints(provider.id)).toEqual([])
  })

  it('falls back to an enabled provider default address when the model carries none', async () => {
    const provider = await createProvider({
      name: 'Fallback Provider',
      apiKeyReference: 'key_fallback_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    await createProviderEndpoint({
      providerId: provider.id,
      protocol: 'openai-responses',
      url: 'https://example.com/v1/responses',
      enabled: true,
    })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'fallback-model',
      priority: 1,
      endpoints: [{ protocol: 'openai-responses', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false }],
    })

    // 绑定上是 `null`（「沿用供应商默认地址」），解析出来的有效地址是供应商那一层的。
    expect((await getProviderModel(route.id))?.endpoints[0]).toMatchObject({ url: null, enabled: true })
    expect((await getProviderModelRoute(route.id))?.endpoints[0]).toMatchObject({ endpointUrl: 'https://example.com/v1/responses' })
  })

  // 校验不能比解析宽松：解析路径（`mapProviderModelRoute`）要求供应商端点 `enabled = true`，
  // 把停用的端点当成可用地址就会存下一个读回来根本没地址的模型。
  it('does not count a disabled provider endpoint as the model address', async () => {
    const provider = await createProvider({
      name: 'Disabled Endpoint Provider',
      apiKeyReference: 'key_disabled_endpoint_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    await createProviderEndpoint({
      providerId: provider.id,
      protocol: 'openai-completions',
      url: 'https://example.com/v1/chat/completions',
      enabled: false,
    })

    await expect(createProviderModelRoute({
      providerId: provider.id,
      modelName: 'disabled-endpoint-model',
      priority: 1,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false }],
    })).rejects.toMatchObject({ code: 'ENDPOINT_URL_MISSING' })
  })

  it('refuses to clear a model address when the provider has no default to fall back to', async () => {
    const provider = await createProvider({
      name: 'Clear Url Provider',
      apiKeyReference: 'key_clear_url_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'clear-url-model',
      priority: 1,
      endpoints: [{ protocol: 'anthropic-messages', endpointUrl: 'https://example.com/anthropic', customAuthHeader: null, protocolConversionEnabled: false }],
    })

    await expect(updateProviderModelRoute(route.id, {
      endpoints: [{ protocol: 'anthropic-messages', endpointUrl: '', customAuthHeader: null, protocolConversionEnabled: false }],
    })).rejects.toMatchObject({ code: 'ENDPOINT_URL_MISSING' })

    // 保存被整体回滚，原来的绑定一字不动。
    expect((await getProviderModelRoute(route.id))?.endpoints[0]).toMatchObject({ endpointUrl: 'https://example.com/anthropic' })
  })

  it('keeps a model url on the binding instead of promoting it to the provider default', async () => {
    const provider = await createProvider({
      name: 'Custom Url Provider',
      apiKeyReference: 'key_custom_url_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const route = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'custom-url-model',
      priority: 1,
      endpoints: [{ protocol: 'anthropic-messages', endpointUrl: 'https://example.com/anthropic', customAuthHeader: null, protocolConversionEnabled: false }],
    })

    // 一个模型的自定义地址不能变成供应商的默认地址：那会悄悄改掉所有同协议绑定的解析结果。
    expect(await listProviderEndpoints(provider.id)).toEqual([
      expect.objectContaining({ protocol: 'anthropic-messages', url: '', enabled: true }),
    ])
    expect((await getProviderModel(route.id))?.endpoints[0]).toMatchObject({ url: 'https://example.com/anthropic' })
    expect((await getProviderModelRoute(route.id))?.endpoints[0]).toMatchObject({ endpointUrl: 'https://example.com/anthropic' })
  })

  // 回归：逻辑模型页开关写的是 scheduling_policies.enabled。JOIN 两表都有 enabled
  // 列时，嵌套 select 会把策略上的 false 读成模型本体的 true，刷新就把开关弹回去。
  it('reports the binding enabled flag, not the provider model flag, for a logical model', async () => {
    const provider = await createProvider({
      name: 'Binding Enabled Provider',
      apiKeyReference: 'key_binding_enabled_provider',
      timeoutMilliseconds: 20_000,
      enabled: true,
    })
    const enabledRoute = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'binding-on',
      priority: 1,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const disabledRoute = await createProviderModelRoute({
      providerId: provider.id,
      modelName: 'binding-off',
      priority: 2,
      endpoints: [{ protocol: 'openai-completions', endpointUrl: 'https://example.com/v1/chat/completions', customAuthHeader: null, protocolConversionEnabled: false }],
    })
    const logicalModel = await createLogicalModel({ id: 'binding-enabled', name: 'binding-enabled' })
    await upsertSchedulingPolicy({ logicalModelId: logicalModel.id, providerModelId: enabledRoute.id, priority: 1, enabled: true })
    await upsertSchedulingPolicy({ logicalModelId: logicalModel.id, providerModelId: disabledRoute.id, priority: 2, enabled: false })

    expect(await listProviderModelsForLogicalModel(logicalModel.id)).toEqual([
      expect.objectContaining({ id: enabledRoute.id, enabled: true, priority: 1 }),
    ])
    expect(await listProviderModelsForLogicalModel(logicalModel.id, false, true)).toEqual([
      expect.objectContaining({ id: enabledRoute.id, enabled: true, priority: 1 }),
      expect.objectContaining({ id: disabledRoute.id, enabled: false, priority: 2 }),
    ])
  })
})
