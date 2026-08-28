export const TransportValues = ['http', 'sse', 'websocket'] as const
export type Transport = typeof TransportValues[number]

export interface EndpointCapability {
  protocol: string
  transport: Transport
  streaming: boolean
}

export function detectTransportFromUrl(url: string): Transport {
  const scheme = new URL(url).protocol
  return scheme === 'ws:' || scheme === 'wss:' ? 'websocket' : 'http'
}
