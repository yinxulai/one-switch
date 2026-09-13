import type { Protocol, Provider, ProviderModelRouteEndpoint } from '@common/schemas'

export interface ProtocolEndpointEntry {
  protocol: Protocol
  enabled: boolean
  overrideUrl: boolean
  endpointUrl: string
  protocolConversionEnabled: boolean
}

export interface ProviderEndpointEntry {
  protocol: Protocol
  enabled: boolean
  url: string
}

export type ProviderEndpoints = Partial<Record<Protocol, string>>

/** 导出范围：单个供应商（详情页）或全部（页面头部）。 */
export type ProviderExportScope = { kind: 'all' } | { kind: 'provider'; provider: Provider }

export function getEffectiveEndpointUrl(endpoint: ProviderModelRouteEndpoint): string {
  return endpoint.endpointUrl.trim()
}
