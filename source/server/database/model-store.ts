import { and, asc, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { ProtocolConverterSchema, ProviderModelEndpointSchema } from '@common/schemas'
import type {
  ProtocolConverter,
  ProviderModel,
  ProviderModelEndpoint,
  ProviderModelRoute,
  ProviderModelRouteEndpoint,
} from '@common/schemas'
import { generateId, now } from '@common/utils'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import { getDb } from './index'
import {
  providerEndpoints,
  providerModelEndpoints,
  providerModelHealth,
  providerModels,
  protocolConverters,
  schedulingPolicies,
} from './schema'

export interface ProviderModelEndpointView extends ProviderModelEndpoint {
  protocol: ProviderModelRouteEndpoint['protocol']
  conversions: ProtocolConverter[]
}

export interface ProviderModelView extends ProviderModel {
  endpoints: ProviderModelEndpointView[]
}

export async function listProviderModels(includeDeleted = false): Promise<ProviderModelView[]> {
  const rows = getDb().select().from(providerModels)
    .where(includeDeleted ? undefined : isNull(providerModels.deletedTime))
    .orderBy(providerModels.createdTime).all()
  return rows.map(mapProviderModelView)
}

export async function listProviderModelsForLogicalModel(logicalModelId: string, includeDeleted = false, includeDisabled = false): Promise<ProviderModelRoute[]> {
  const rows = getDb().select({ model: providerModels, policy: schedulingPolicies })
    .from(schedulingPolicies)
    .innerJoin(providerModels, eq(schedulingPolicies.providerModelId, providerModels.id))
    .where(and(eq(schedulingPolicies.logicalModelId, logicalModelId), isNull(schedulingPolicies.deletedTime)))
    .orderBy(asc(schedulingPolicies.priority), desc(schedulingPolicies.weight), asc(schedulingPolicies.createdTime), asc(schedulingPolicies.providerModelId))
    .all()
  return rows
    .filter(({ model }) => (includeDeleted || model.deletedTime === null) && (includeDisabled || model.enabled))
    .map(({ model, policy }) => ({
      ...mapProviderModelRoute(model),
      priority: policy.priority,
      // enabled 反映模型自身状态：管理页需要展示被禁用的模型，
      // 调度筛选已在上面的 filter 中完成，不能被策略的 enabled 覆盖。
      enabled: model.enabled,
    }))
}

export async function getProviderModel(id: string): Promise<ProviderModelView | undefined> {
  const row = getDb().select().from(providerModels).where(eq(providerModels.id, id)).get()
  return row ? mapProviderModelView(row) : undefined
}

export async function listProviderModelRoutesByProvider(providerId: string, includeDeleted = false): Promise<ProviderModelRoute[]> {
  const rows = getDb().select().from(providerModels)
    .where(includeDeleted ? eq(providerModels.providerId, providerId) : and(eq(providerModels.providerId, providerId), isNull(providerModels.deletedTime)))
    .orderBy(providerModels.createdTime).all()
  return rows.map(mapProviderModelRoute)
}

export async function listProviderModelRoutes(includeDeleted = true): Promise<ProviderModelRoute[]> {
  const rows = getDb().select().from(providerModels)
    .where(includeDeleted ? undefined : isNull(providerModels.deletedTime))
    .orderBy(providerModels.createdTime).all()
  return rows.map(mapProviderModelRoute)
}

export async function getProviderModelRoute(id: string): Promise<ProviderModelRoute | undefined> {
  const row = getDb().select().from(providerModels).where(eq(providerModels.id, id)).get()
  return row ? mapProviderModelRoute(row) : undefined
}

type CreateProviderModelRouteInput = Pick<ProviderModelRoute, 'providerId' | 'modelName' | 'priority'> & Partial<Pick<ProviderModelRoute, 'endpoints' | 'enabled'>>

export async function createProviderModelRoute(input: CreateProviderModelRouteInput): Promise<ProviderModelRoute> {
  const id = generateId('model_')
  const time = now()
  const db = getDb()
  db.transaction(transaction => {
    transaction.insert(providerModels).values({ id, providerId: input.providerId, modelName: input.modelName, enabled: input.enabled ?? true, createdTime: time, updatedTime: time }).run()
    transaction.insert(providerModelHealth).values({ providerModelId: id, updatedTime: time }).run()
    replaceRouteEndpoints(transaction, id, input.providerId, input.endpoints ?? [], time)
  })
  return { id, providerId: input.providerId, modelName: input.modelName, endpoints: input.endpoints ?? [], priority: input.priority, enabled: input.enabled ?? true, createdTime: time, updatedTime: time, deletedTime: null }
}

export async function updateProviderModelRoute(id: string, updates: Partial<Omit<ProviderModelRoute, 'id' | 'createdTime'>>): Promise<ProviderModelRoute> {
  const time = now()
  const db = getDb()
  const existing = await getProviderModelRoute(id)
  if (!existing) throw new Error(`provider model not found: ${id}`)
  db.transaction(transaction => {
    transaction.update(providerModels).set({
      ...(updates.providerId !== undefined ? { providerId: updates.providerId } : {}),
      ...(updates.modelName !== undefined ? { modelName: updates.modelName } : {}),
      ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
      ...(updates.deletedTime !== undefined ? { deletedTime: updates.deletedTime } : {}),
      updatedTime: time,
    }).where(eq(providerModels.id, id)).run()
    if (updates.endpoints !== undefined) {
      // 端点集合变化交给 `replaceRouteEndpoints` 做差异更新：没变的绑定原地保留
      // （连同它的 id），只对增减做软删除/新增。
      replaceRouteEndpoints(transaction, id, updates.providerId ?? existing.providerId, updates.endpoints, time)
    }
  })
  return { ...existing, ...updates, id, updatedTime: time }
}

/**
 * 删除模型：软删除模型本身，并把挂在它下面的东西一起打标。
 *
 * 绑定、协议转换器、调度策略全部以这个模型为主语，模型软删了它们就不该再被读到
 * （逻辑模型中也不该再出现一个已删除的模型）。打标而不是删除，是为了之后仍能回答
 * 「这个模型以前绑过哪个端点」。
 */
export async function deleteProviderModelRoute(id: string): Promise<void> {
  const time = now()
  getDb().transaction(transaction => {
    const bindingIds = transaction.select({ id: providerModelEndpoints.id }).from(providerModelEndpoints)
      .where(and(eq(providerModelEndpoints.providerModelId, id), isNull(providerModelEndpoints.deletedTime))).all().map(row => row.id)
    if (bindingIds.length > 0) {
      transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
        .where(and(inArray(protocolConverters.providerModelEndpointId, bindingIds), isNull(protocolConverters.deletedTime))).run()
      transaction.update(providerModelEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
        .where(inArray(providerModelEndpoints.id, bindingIds)).run()
    }
    transaction.update(schedulingPolicies).set({ enabled: false, deletedTime: time, updatedTime: time })
      .where(and(eq(schedulingPolicies.providerModelId, id), isNull(schedulingPolicies.deletedTime))).run()
    transaction.update(providerModels).set({ enabled: false, deletedTime: time, updatedTime: time })
      .where(and(eq(providerModels.id, id), isNull(providerModels.deletedTime))).run()
  })
}

export async function listProviderModelEndpoints(providerModelId: string): Promise<ProviderModelEndpoint[]> {
  return getDb().select().from(providerModelEndpoints)
    .where(and(eq(providerModelEndpoints.providerModelId, providerModelId), isNull(providerModelEndpoints.deletedTime)))
    .orderBy(providerModelEndpoints.createdTime, providerModelEndpoints.id).all().map(parseProviderModelEndpoint)
}

export async function getProviderModelEndpoint(id: string): Promise<ProviderModelEndpoint | undefined> {
  const row = getDb().select().from(providerModelEndpoints).where(and(eq(providerModelEndpoints.id, id), isNull(providerModelEndpoints.deletedTime))).get()
  return row ? parseProviderModelEndpoint(row) : undefined
}

type CreateProviderModelEndpointInput = Omit<ProviderModelEndpoint, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime' | 'url' | 'enabled'> & { url?: string | null; enabled?: boolean }

export async function createProviderModelEndpoint(input: CreateProviderModelEndpointInput): Promise<ProviderModelEndpoint> {
  const time = now()
  const endpoint = ProviderModelEndpointSchema.parse({ ...input, id: generateId('pme_'), url: input.url ?? null, enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  getDb().insert(providerModelEndpoints).values({ ...endpoint, deletedTime: null }).run()
  return endpoint
}

export async function updateProviderModelEndpoint(id: string, updates: Partial<Pick<ProviderModelEndpoint, 'providerEndpointId' | 'url' | 'enabled'>>): Promise<ProviderModelEndpoint> {
  const existing = await getProviderModelEndpoint(id)
  if (!existing) throw new Error(`provider model endpoint not found: ${id}`)
  const endpoint = ProviderModelEndpointSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getDb().update(providerModelEndpoints).set({ providerEndpointId: endpoint.providerEndpointId, url: endpoint.url, enabled: endpoint.enabled, updatedTime: endpoint.updatedTime })
    .where(and(eq(providerModelEndpoints.id, id), isNull(providerModelEndpoints.deletedTime))).run()
  return endpoint
}

/** 软删除一条绑定（连同它的协议转换器）：行留下来才能回答「这个模型以前绑过什么」。 */
export async function deleteProviderModelEndpoint(id: string): Promise<void> {
  const time = now()
  getDb().transaction(transaction => {
    transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
      .where(and(eq(protocolConverters.providerModelEndpointId, id), isNull(protocolConverters.deletedTime))).run()
    transaction.update(providerModelEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
      .where(and(eq(providerModelEndpoints.id, id), isNull(providerModelEndpoints.deletedTime))).run()
  })
}

export async function listProtocolConverters(providerModelEndpointId: string): Promise<ProtocolConverter[]> {
  return getDb().select().from(protocolConverters)
    .where(and(eq(protocolConverters.providerModelEndpointId, providerModelEndpointId), isNull(protocolConverters.deletedTime)))
    .orderBy(protocolConverters.createdTime, protocolConverters.id).all().map(parseProtocolConverter)
}

export async function getProtocolConverter(id: string): Promise<ProtocolConverter | undefined> {
  const row = getDb().select().from(protocolConverters).where(and(eq(protocolConverters.id, id), isNull(protocolConverters.deletedTime))).get()
  return row ? parseProtocolConverter(row) : undefined
}

type CreateProtocolConverterInput = Omit<ProtocolConverter, 'id' | 'createdTime' | 'updatedTime' | 'enabled' | 'deletedTime'> & { enabled?: boolean }

export async function createProtocolConverter(input: CreateProtocolConverterInput): Promise<ProtocolConverter> {
  const time = now()
  const converter = ProtocolConverterSchema.parse({ ...input, id: generateId('conv_'), enabled: input.enabled ?? true, createdTime: time, updatedTime: time })
  getDb().insert(protocolConverters).values({ ...converter, deletedTime: null }).run()
  return converter
}

export async function updateProtocolConverter(id: string, updates: Partial<Pick<ProtocolConverter, 'clientProtocol' | 'enabled'>>): Promise<ProtocolConverter> {
  const existing = await getProtocolConverter(id)
  if (!existing) throw new Error(`protocol converter not found: ${id}`)
  const converter = ProtocolConverterSchema.parse({ ...existing, ...updates, id, updatedTime: now() })
  getDb().update(protocolConverters).set({ clientProtocol: converter.clientProtocol, enabled: converter.enabled, updatedTime: converter.updatedTime })
    .where(and(eq(protocolConverters.id, id), isNull(protocolConverters.deletedTime))).run()
  return converter
}

export async function deleteProtocolConverter(id: string): Promise<void> {
  const time = now()
  getDb().update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
    .where(and(eq(protocolConverters.id, id), isNull(protocolConverters.deletedTime))).run()
}

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/**
 * 把模型的端点绑定调成给定集合。
 *
 * 「目标集合」是完整的：目标里没有的绑定一律软删除（连带它的转换器），
 * 目标里有的则原地更新——能重用就不新增，行的 id 保持稳定，
 * 因此频繁编辑模型不会每次都把全部绑定重建一遍。
 */
function replaceRouteEndpoints(transaction: Transaction, modelId: string, providerId: string, endpoints: ProviderModelRouteEndpoint[], time: number): void {
  const activeBindings = transaction.select().from(providerModelEndpoints)
    .where(and(eq(providerModelEndpoints.providerModelId, modelId), isNull(providerModelEndpoints.deletedTime))).all()
  const retainedBindingIds = new Set<string>()

  for (const endpoint of endpoints) {
    const endpointRow = transaction.select().from(providerEndpoints)
      .where(and(eq(providerEndpoints.providerId, providerId), eq(providerEndpoints.protocol, endpoint.protocol), isNull(providerEndpoints.deletedTime))).get()
    const endpointId = endpointRow?.id ?? generateId('end_')
    if (!endpointRow) transaction.insert(providerEndpoints).values({ id: endpointId, providerId, protocol: endpoint.protocol, url: endpoint.endpointUrl || 'https://invalid.local', createdTime: time, updatedTime: time, deletedTime: null }).run()

    const binding = activeBindings.find(item => item.providerEndpointId === endpointId)
    const bindingId = binding?.id ?? generateId('pme_')
    if (binding) transaction.update(providerModelEndpoints).set({ url: endpoint.endpointUrl || null, enabled: true, updatedTime: time }).where(eq(providerModelEndpoints.id, bindingId)).run()
    else transaction.insert(providerModelEndpoints).values({ id: bindingId, providerModelId: modelId, providerEndpointId: endpointId, url: endpoint.endpointUrl || null, enabled: true, createdTime: time, updatedTime: time, deletedTime: null }).run()
    retainedBindingIds.add(bindingId)

    syncProtocolConverters(transaction, bindingId, endpoint.protocol, endpoint.protocolConversionEnabled, time)
  }

  const removedBindings = activeBindings.filter(binding => !retainedBindingIds.has(binding.id))
  if (removedBindings.length === 0) return
  const removedBindingIds = removedBindings.map(binding => binding.id)
  transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
    .where(and(inArray(protocolConverters.providerModelEndpointId, removedBindingIds), isNull(protocolConverters.deletedTime))).run()
  transaction.update(providerModelEndpoints).set({ enabled: false, deletedTime: time, updatedTime: time })
    .where(inArray(providerModelEndpoints.id, removedBindingIds)).run()
}

/**
 * 把一条绑定的协议转换器调成给定状态。
 *
 * 开启转换时目标集合是 `CONVERTIBLE_PROTOCOLS[protocol]`，关闭时是空集。
 * 同 `replaceRouteEndpoints`：能重用就原地启用，多出来的软删除。
 */
function syncProtocolConverters(transaction: Transaction, providerModelEndpointId: string, protocol: ProviderModelRouteEndpoint['protocol'], enabled: boolean, time: number): void {
  const desiredProtocols = enabled ? CONVERTIBLE_PROTOCOLS[protocol] : []
  const activeConverters = transaction.select().from(protocolConverters)
    .where(and(eq(protocolConverters.providerModelEndpointId, providerModelEndpointId), isNull(protocolConverters.deletedTime))).all()
  const activeByProtocol = new Map(activeConverters.map(converter => [converter.clientProtocol, converter]))
  const retainedProtocols: string[] = []

  for (const clientProtocol of desiredProtocols) {
    retainedProtocols.push(clientProtocol)
    const active = activeByProtocol.get(clientProtocol)
    if (active) {
      if (!active.enabled) transaction.update(protocolConverters).set({ enabled: true, updatedTime: time }).where(eq(protocolConverters.id, active.id)).run()
      continue
    }
    transaction.insert(protocolConverters).values({ id: generateId('conv_'), providerModelEndpointId, clientProtocol, enabled: true, createdTime: time, updatedTime: time, deletedTime: null }).run()
  }

  transaction.update(protocolConverters).set({ enabled: false, deletedTime: time, updatedTime: time })
    .where(and(
      eq(protocolConverters.providerModelEndpointId, providerModelEndpointId),
      isNull(protocolConverters.deletedTime),
      retainedProtocols.length === 0 ? undefined : notInArray(protocolConverters.clientProtocol, retainedProtocols),
    )).run()
}

function parseProviderModelEndpoint(row: typeof providerModelEndpoints.$inferSelect): ProviderModelEndpoint {
  return ProviderModelEndpointSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) })
}

function parseProtocolConverter(row: typeof protocolConverters.$inferSelect): ProtocolConverter {
  return ProtocolConverterSchema.parse({ ...row, createdTime: Number(row.createdTime), updatedTime: Number(row.updatedTime) })
}

function mapProviderModelView(row: typeof providerModels.$inferSelect): ProviderModelView {
  const endpointRows = getDb().select({ endpoint: providerEndpoints, binding: providerModelEndpoints })
    .from(providerModelEndpoints)
    .innerJoin(providerEndpoints, eq(providerModelEndpoints.providerEndpointId, providerEndpoints.id))
    .where(and(eq(providerModelEndpoints.providerModelId, row.id), eq(providerModelEndpoints.enabled, true), isNull(providerModelEndpoints.deletedTime), eq(providerEndpoints.enabled, true), isNull(providerEndpoints.deletedTime))).all()
  return {
    id: row.id,
    providerId: row.providerId,
    modelName: row.modelName,
    enabled: row.enabled,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
    endpoints: endpointRows.map(({ endpoint, binding }) => ({
      ...parseProviderModelEndpoint(binding),
      protocol: endpoint.protocol as ProviderModelRouteEndpoint['protocol'],
      conversions: getDb().select().from(protocolConverters).where(and(eq(protocolConverters.providerModelEndpointId, binding.id), isNull(protocolConverters.deletedTime))).all().map(parseProtocolConverter),
    })),
  }
}

function mapProviderModelRoute(row: typeof providerModels.$inferSelect): ProviderModelRoute {
  const endpointRows = getDb().select({ endpoint: providerEndpoints, binding: providerModelEndpoints })
    .from(providerModelEndpoints)
    .innerJoin(providerEndpoints, eq(providerModelEndpoints.providerEndpointId, providerEndpoints.id))
    .where(and(eq(providerModelEndpoints.providerModelId, row.id), eq(providerModelEndpoints.enabled, true), isNull(providerModelEndpoints.deletedTime), eq(providerEndpoints.enabled, true), isNull(providerEndpoints.deletedTime))).all()
  return {
    id: row.id,
    providerId: row.providerId,
    modelName: row.modelName,
    endpoints: endpointRows.map(({ endpoint, binding }) => ({
      protocol: endpoint.protocol as ProviderModelRouteEndpoint['protocol'],
      endpointUrl: binding.url ?? endpoint.url,
      customAuthHeader: null,
      protocolConversionEnabled: getDb().select().from(protocolConverters).where(and(eq(protocolConverters.providerModelEndpointId, binding.id), isNull(protocolConverters.deletedTime))).all().some(conversion => conversion.enabled),
    })),
    priority: 0,
    enabled: row.enabled,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}
