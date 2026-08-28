import type { IncomingHttpHeaders } from 'node:http'
import { generateId } from '@common/utils'
import type { Protocol, RequestStatus } from '@common/schemas'
import { getSettings } from '../../database/settings-store'
import { createAttemptLogger, initializeRequestLogger, type RequestLogger } from './logging'
import { mergeResponseUsage, type ExtractedUsage } from './response-pipeline'
import type { ModelWithProvider } from './router'
import type { WebSocketTurnObservation } from '../protocols/websocket-adapters/types'

export interface WebSocketTurnObserverOptions {
  logicalModelId: string
  protocol: Protocol
  path: string
  requestHeaders: IncomingHttpHeaders
  upstreamUrl: string
  target: ModelWithProvider
}

type TurnState = { requestId: string; correlationKey?: string; startedAt: number; logger: RequestLogger; attemptLogger: Pick<RequestLogger, 'recordAttempt' | 'recordAttemptContent'>; events: string[]; usage: ExtractedUsage; firstOutputAt: number | null; completed: boolean }

export class WebSocketTurnObserver {
  private readonly turns = new Map<string, TurnState>()
  private readonly correlatedTurns = new Map<string, TurnState>()
  private attemptIndex = 0
  private settingsPromise: ReturnType<typeof getSettings> | null = null

  constructor(private readonly options: WebSocketTurnObserverOptions) {}

  async start(payload: string, correlationKey?: string): Promise<void> {
    const startedAt = Date.now()
    const settings = await (this.settingsPromise ?? (this.settingsPromise = getSettings()))
    const requestId = generateId('req_')
    const requestBody = Buffer.from(payload)
    const { logicalModelId, protocol, path, requestHeaders, target, upstreamUrl } = this.options
    const logger = await initializeRequestLogger({ requestId, logicalModelId, clientProtocol: protocol, method: 'WEBSOCKET', path, headers: requestHeaders, requestBody, captureRequestContent: settings.captureRequestContent })
    const attemptLogger = createAttemptLogger({ requestId, attemptIndex: this.attemptIndex++, startedAt, snapshot: { providerId: target.provider.id, providerModelId: target.model.id, providerName: target.provider.name, providerModelName: target.model.modelName, upstreamProtocol: protocol, url: upstreamUrl }, method: 'WEBSOCKET', path, requestHeaders, requestBody, upstreamRequestHeaders: {}, upstreamRequestBody: requestBody, clientProtocol: protocol, upstreamProtocol: protocol, requiresResponseConversion: false, captureRequestContent: settings.captureRequestContent, hooks: {} })
    const state = { requestId, correlationKey, startedAt, logger, attemptLogger, events: [], usage: emptyUsage(), firstOutputAt: null, completed: false }
    this.turns.set(requestId, state)
    if (correlationKey) this.correlatedTurns.set(correlationKey, state)
  }

  async observe(observation: WebSocketTurnObservation, raw: string): Promise<void> {
    let state = observation.correlationKey ? this.correlatedTurns.get(observation.correlationKey) : undefined
    if (!state) state = [...this.turns.values()].find(candidate => !candidate.completed)
    if (!state || state.completed) return
    if (observation.correlationKey && !state.correlationKey) {
      state.correlationKey = observation.correlationKey
      this.correlatedTurns.set(observation.correlationKey, state)
    }
    state.events.push(raw)
    state.usage = mergeResponseUsage(state.usage, observation.usage ?? emptyUsage())
    if (state.firstOutputAt === null && observation.hasOutput) state.firstOutputAt = Date.now()
    if (observation.type === 'complete') await this.finish(state, 'success', null)
    if (observation.type === 'failed') await this.finish(state, 'failed', observation.error ?? raw)
  }

  async finishAll(status: Extract<RequestStatus, 'failed' | 'cancelled'>, error: string | null): Promise<void> {
    await Promise.all([...this.turns.values()].map(state => this.finish(state, status, error)))
  }

  private async finish(state: TurnState, status: RequestStatus, errorBody: string | null): Promise<void> {
    if (state.completed) return
    state.completed = true
    this.turns.delete(state.requestId)
    if (state.correlationKey) this.correlatedTurns.delete(state.correlationKey)
    const responseBody = state.events.length > 0 ? JSON.stringify({ schemaVersion: 1, events: state.events }) : errorBody
    const attempt = await state.attemptLogger.recordAttempt(status, status === 'success' ? 101 : null, false, status === 'success' ? undefined : 'WS_RESPONSE_FAILED', errorBody ?? undefined, undefined, undefined, state.usage)
    await state.attemptLogger.recordAttemptContent({ attemptId: attempt?.id ?? null, captureStatus: status === 'success' ? 'captured' : 'partial', responseStatus: status === 'success' ? 101 : null, upstreamResponseHeaders: null, clientResponseHeaders: null, responseBody })
    await state.logger.finalizeRequestContent({ statusCode: status === 'success' ? 101 : 502, captureStatus: status === 'success' ? 'captured' : 'partial', ...(status === 'success' ? { responseStatus: 101 } : {}), responseBody })
    const usage = state.usage
    await state.logger.finalizeRequestLog(status, state.startedAt, { ttftMilliseconds: state.firstOutputAt === null ? null : state.firstOutputAt - state.startedAt, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, cachedInputTokens: usage.cachedInputTokens, cacheCreationInputTokens: usage.cacheCreationInputTokens, rawUsage: usage.rawUsage, upstreamProtocol: this.options.protocol })
  }
}

function emptyUsage(): ExtractedUsage { return { inputTokens: null, outputTokens: null, reasoningTokens: null, cachedInputTokens: null, cacheCreationInputTokens: null, rawUsage: null } }
