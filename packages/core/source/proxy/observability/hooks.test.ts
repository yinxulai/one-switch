import { describe, expect, it } from 'vitest'
import { createRequestContext } from '@server/proxy/request/request-context'
import { NOOP_PROXY_OBSERVATION_HOOKS, type ProxyObservationHooks } from '@server/proxy/observability/hooks'

describe('proxy observation hooks', () => {
  it('exposes a protocol-neutral request context contract', async () => {
    const calls: string[] = []
    const hooks: ProxyObservationHooks = {
      onRequestStarted: context => {
        calls.push(`${context.requestId}:${context.clientProtocol}`)
      },
    }
    await hooks.onRequestStarted?.(createRequestContext({
      requestId: 'req_test',
      logicalModelId: 'default',
      clientProtocol: 'openai-responses',
      method: 'POST',
      path: '/v1/responses',
      requestBody: Buffer.from('{}'),
    }))

    expect(calls).toEqual(['req_test:openai-responses'])
  })

  it('exposes a no-op hook set that is safe to invoke', async () => {
    // 所有回调都是可选的，调用方需要能无条件调用而不做空值判断。
    expect(NOOP_PROXY_OBSERVATION_HOOKS.onRequestStarted).toBeUndefined()
    expect(NOOP_PROXY_OBSERVATION_HOOKS.onAttemptRecorded).toBeUndefined()
    expect(NOOP_PROXY_OBSERVATION_HOOKS.onContentCaptured).toBeUndefined()

    const result = NOOP_PROXY_OBSERVATION_HOOKS.onRequestStarted?.(createRequestContext({
      requestId: 'req_noop',
      logicalModelId: 'default',
      clientProtocol: 'openai-completions',
      method: 'POST',
      path: '/v1/chat/completions',
      requestBody: Buffer.from('{}'),
    }))
    expect(result).toBeUndefined()
  })
})
