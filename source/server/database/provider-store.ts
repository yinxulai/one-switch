import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { ProviderEndpointSchema, ProviderSchema, ProviderSettingSchema } from '@common/schemas'
import type { Provider, ProviderEndpoint, ProviderSetting } from '@common/schemas'
import { generateId, now } from '@common/utils'
import { getDb } from './index'
import {
  providerEndpoints,
  providerHealth,
  providerModelEndpoints,
  providerModels,
  protocolConverters,
  providerSettings,
  providers,
} from './schema'

export async function listProviders(includeDeleted = false): Promise<Provider[]> {
  const db = getDb()
  const rows = includeDeleted
    ? db.select().from(providers).orderBy(desc(providers.createdTime)).all()
    : db.select().from(providers).where(isNull(providers.deletedTime)).orderBy(desc(providers.createdTime)).all()
  return rows.map(mapProvider)
}

export async function getProvider(id: string): Promise<Provider | undefined> {
  const row = getDb().select().from(providers).where(eq(providers.id, id)).get()
  return row ? mapProvider(row) : undefined
}

type CreateProviderInput = { name: string; description?: string; apiKeyReference: string; timeoutMilliseconds?: number; enabled?: boolean }

export async function createProvider(input: CreateProviderInput): Promise<Provider> {
  const id = generateId('prov_')
  const time = now()
  const db = getDb()
  const provider = ProviderSchema.parse({ ...input, description: input.description ?? '', id, createdTime: time, updatedTime: time, deletedTime: null })
  db.insert(providers).values({ id, name: provider.name, description: provider.description ?? '', enabled: provider.enabled, createdTime: time, updatedTime: time }).run()
  db.insert(providerSettings).values([
    { providerId: id, key: 'security.secretReference', value: provider.apiKeyReference, valueType: 'string', updatedTime: time },
    { providerId: id, key: 'connection.timeoutMilliseconds', value: String(provider.timeoutMilliseconds), valueType: 'number', updatedTime: time },
  ]).run()
  db.insert(providerHealth).values({ providerId: id, consecutiveFailures: 0, updatedTime: time }).run()
  return provider
}

export async function updateProvider(id: string, updates: Partial<Omit<Provider, 'id' | 'createdTime'>>): Promise<Provider> {
  const db = getDb()
  const time = now()
  const existing = db.select().from(providers).where(eq(providers.id, id)).get()
  if (!existing) throw new Error(`provider not found: ${id}`)
  const next = ProviderSchema.parse({ ...mapProvider(existing), ...updates, id, createdTime: Number(existing.createdTime), updatedTime: time })
  db.update(providers).set({ name: next.name, description: next.description ?? '', enabled: next.enabled, updatedTime: time, deletedTime: next.deletedTime }).where(and(eq(providers.id, id), isNull(providers.deletedTime))).run()
  for (const [key, value, valueType] of [
    ['security.secretReference', next.apiKeyReference, 'string'],
    ['connection.timeoutMilliseconds', String(next.timeoutMilliseconds), 'number'],
  ] as const) {
    db.insert(providerSettings).values({ providerId: id, key, value, valueType, updatedTime: time }).onConflictDoUpdate({
      target: [providerSettings.providerId, providerSettings.key], set: { value, valueType, updatedTime: time },
    }).run()
  }
  return next
}

export async function listProviderSettings(providerId: string): Promise<ProviderSetting[]> {
  return getDb().select().from(providerSettings).where(eq(providerSettings.providerId, providerId)).orderBy(providerSettings.key).all().map(row => ProviderSettingSchema.parse({ ...row, updatedTime: Number(row.updatedTime) }))
}

export async function getProviderSetting(providerId: string, key: string): Promise<ProviderSetting | undefined> {
  const row = getDb().select().from(providerSettings).where(and(eq(providerSettings.providerId, providerId), eq(providerSettings.key, key))).get()
  return row ? ProviderSettingSchema.parse({ ...row, updatedTime: Number(row.updatedTime) }) : undefined
}

export async function upsertProviderSetting(input: Omit<ProviderSetting, 'updatedTime'>): Promise<ProviderSetting> {
  const setting = ProviderSettingSchema.parse({ ...input, updatedTime: now() })
  getDb().insert(providerSettings).values(setting).onConflictDoUpdate({
    target: [providerSettings.providerId, providerSettings.key], set: { value: setting.value, valueType: setting.valueType, updatedTime: setting.updatedTime },
  }).run()
  return setting
}

export async function deleteProviderSetting(providerId: string, key: string): Promise<void> {
  getDb().delete(providerSettings).where(and(eq(providerSettings.providerId, providerId), eq(providerSettings.key, key))).run()
}

export async function listProviderEndpoints(providerId: string): Promise<ProviderEndpoint[]> {
  return getDb().select().from(providerEndpoints)
    .where(and(eq(providerEndpoints.providerId, providerId), isNull(providerEndpoints.deletedTime)))
    .orderBy(providerEndpoints.protocol).all().map(mapProviderEndpoint)
}

export async function getProviderEndpoint(id: string): Promise<ProviderEndpoint | undefined> {
  const row = getDb().select().from(providerEndpoints).where(and(eq(providerEndpoints.id, id), isNull(providerEndpoints.deletedTime))).get()
  return row ? mapProviderEndpoint(row) : undefined
}

function mapProviderEndpoint(row: typeof providerEndpoints.$inferSelect): ProviderEndpoint {
  return ProviderEndpointSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) })
}

type CreateProviderEndpointInput = Omit<ProviderEndpoint, 'id' | 'createdTime' | 'updatedTime' | 'enabled' | 'deletedTime'> & { enabled?: boolean }

export async function createProviderEndpoint(input: CreateProviderEndpointInput): Promise<ProviderEndpoint> {
  const time = now()
  const endpoint = ProviderEndpointSchema.parse({ ...input, id: generateId('end_'), enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  getDb().insert(providerEndpoints).values({ ...endpoint, deletedTime: null }).run()
  return endpoint
}

export async function updateProviderEndpoint(id: string, updates: Partial<Pick<ProviderEndpoint, 'protocol' | 'url' | 'enabled'>>): Promise<ProviderEndpoint> {
  const existing = await getProviderEndpoint(id)
  if (!existing) throw new Error(`provider endpoint not found: ${id}`)
  const endpoint = ProviderEndpointSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getDb().update(providerEndpoints).set({ protocol: endpoint.protocol, url: endpoint.url, enabled: endpoint.enabled, updatedTime: endpoint.updatedTime })
    .where(and(eq(providerEndpoints.id, id), isNull(providerEndpoints.deletedTime))).run()
  return endpoint
}

/**
 * 删除端点：一律软删除。
 *
 * 端点下面挂著「模型 ↔ 端点」绑定与协议转换器，硬删除端点会顺手把它们一起扔掉——
 * 那些行是用户在模型上配好的东西，不是缓存。所以这里统一改成打标：端点、绑定、
 * 转换器全部置 `deletedTime`（并停用），行留在表里，已部署的日志/看板仍能把它们解解出来。
 */
export async function deleteProviderEndpoint(id: string): Promise<void> {
  const time = now()
  getDb().transaction(transaction => {
    const bindingRows = transaction.select({ id: providerModelEndpoints.id }).from(providerModelEndpoints)
      .where(and(eq(providerModelEndpoints.providerEndpointId, id), isNull(providerModelEndpoints.deletedTime))).all()
    if (bindingRows.length > 0) {
      const bindingIds = bindingRows.map(binding => binding.id)
      transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
        .where(and(inArray(protocolConverters.providerModelEndpointId, bindingIds), isNull(protocolConverters.deletedTime))).run()
      transaction.update(providerModelEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
        .where(inArray(providerModelEndpoints.id, bindingIds)).run()
    }
    transaction.update(providerEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
      .where(and(eq(providerEndpoints.id, id), isNull(providerEndpoints.deletedTime))).run()
  })
}

export async function replaceProviderEndpoints(providerId: string, endpoints: Partial<Record<ProviderEndpoint['protocol'], string>>): Promise<ProviderEndpoint[]> {
  const states = Object.entries(endpoints)
    .filter(([, url]) => Boolean(url?.trim()))
    .map(([protocol, url]) => ({ protocol: protocol as ProviderEndpoint['protocol'], url: String(url).trim(), enabled: true }))
  return replaceProviderEndpointStates(providerId, states)
}

/**
 * 按给定状态整体替换供应商端点。
 *
 * `replaceProviderEndpoints` 只接受「启用的 protocol → url」映射，表达不了「这一行地址还在，只是被
 * 停用了」——那条行带着用户填过的 URL，是用户可见状态而不是缓存。供应商导入导出需要完整往返，
 * 所以这里额外接收 `enabled`。传入的端点集合即该供应商的端点全集：没提到的协议一律置为禁用。
 */
export async function replaceProviderEndpointStates(providerId: string, endpoints: Array<Pick<ProviderEndpoint, 'protocol' | 'url' | 'enabled'>>): Promise<ProviderEndpoint[]> {
  const db = getDb()
  const time = now()
  db.transaction(transaction => {
    const activeRows = transaction.select().from(providerEndpoints)
      .where(and(eq(providerEndpoints.providerId, providerId), isNull(providerEndpoints.deletedTime))).all()
    const activeByProtocol = new Map(activeRows.map(row => [row.protocol, row]))
    const retainedProtocols: string[] = []
    for (const { protocol, url, enabled } of endpoints) {
      const trimmed = url.trim()
      if (!trimmed) continue
      retainedProtocols.push(protocol)
      const active = activeByProtocol.get(protocol)
      // 就地更新而不是「先删后插」：行的 id 保持不变，导出/导入和日志里的引用都不会跟着变。
      if (active) transaction.update(providerEndpoints).set({ url: trimmed, enabled, updatedTime: time }).where(eq(providerEndpoints.id, active.id)).run()
      else transaction.insert(providerEndpoints).values({ id: generateId('end_'), providerId, protocol, url: trimmed, enabled, createdTime: time, updatedTime: time, deletedTime: null }).run()
    }
    transaction.update(providerEndpoints).set({ enabled: false, updatedTime: time })
      .where(and(
        eq(providerEndpoints.providerId, providerId),
        isNull(providerEndpoints.deletedTime),
        retainedProtocols.length === 0 ? undefined : notInArray(providerEndpoints.protocol, retainedProtocols),
      )).run()
  })
  return listProviderEndpoints(providerId)
}

export async function deleteProvider(id: string): Promise<void> {
  const time = now()
  getDb().transaction(transaction => {
    transaction.update(providers).set({ deletedTime: time, updatedTime: time }).where(and(eq(providers.id, id), isNull(providers.deletedTime))).run()
    transaction.update(providerModels).set({ enabled: false, updatedTime: time, deletedTime: time }).where(and(eq(providerModels.providerId, id), isNull(providerModels.deletedTime))).run()
    // 端点、模型-端点绑定、协议转换器一并软删除：它们是供应商的子结构，
    // 只有打标才能保住「这个模型曾经绑过哪个端点/开过哪些协议转换」这份信息。
    const endpointIds = transaction.select({ id: providerEndpoints.id }).from(providerEndpoints).where(eq(providerEndpoints.providerId, id)).all().map(row => row.id)
    const modelIds = transaction.select({ id: providerModels.id }).from(providerModels).where(eq(providerModels.providerId, id)).all().map(row => row.id)
    if (modelIds.length > 0) {
      const bindingIds = transaction.select({ id: providerModelEndpoints.id }).from(providerModelEndpoints)
        .where(inArray(providerModelEndpoints.providerModelId, modelIds)).all().map(row => row.id)
      if (bindingIds.length > 0) {
        transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
          .where(and(inArray(protocolConverters.providerModelEndpointId, bindingIds), isNull(protocolConverters.deletedTime))).run()
        transaction.update(providerModelEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
          .where(and(inArray(providerModelEndpoints.id, bindingIds), isNull(providerModelEndpoints.deletedTime))).run()
      }
    }
    if (endpointIds.length > 0) {
      transaction.update(providerEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
        .where(and(inArray(providerEndpoints.id, endpointIds), isNull(providerEndpoints.deletedTime))).run()
    }
  })
}

function mapProvider(row: typeof providers.$inferSelect): Provider {
  const settingRows = getDb().select().from(providerSettings).where(eq(providerSettings.providerId, row.id)).all()
  const values = new Map(settingRows.map(setting => [setting.key, setting.value]))
  return {
    id: row.id, name: row.name, description: row.description, apiKeyReference: values.get('security.secretReference') ?? '',
    timeoutMilliseconds: Number(values.get('connection.timeoutMilliseconds') ?? 30000), enabled: row.enabled,
    createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime), deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}
