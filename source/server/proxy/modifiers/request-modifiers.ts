import type { Modifier, ModifierContext } from '@server/proxy/contracts'
import type { RequestRewriteRule } from '@common/schemas'
import type { ProtocolAdapter } from '@server/proxy/protocols/shared/types'
import type { RequestContext } from '@server/proxy/request/request-context'
import { createUpstreamRequestHeaders } from '@server/proxy/response/headers'
import { applyRequestRewriteRules } from '@server/proxy/request-rewrite/request-rewrite-engine'

/** 一次规则评估的结果，供调用方落日志（规则数、命中数、字数变化）。 */
export interface RewriteEvaluation {
  appliedRuleIds: string[]
  skippedRuleIds: string[]
  bodyBytesBefore: number
  bodyBytesAfter: number
}

export interface RequestModifierOptions {
  /** 客户端协议与上游协议之间的适配器：模型改写、请求默认值、请求体转换都在它里面。 */
  adapter: ProtocolAdapter
  /** 适配器需要的请求投影，正文取客户端原文。 */
  requestContext: RequestContext
  /** 上游真实模型名；模型改写用的就是它。 */
  providerModelName: string
  /** 已经解析好的上游认证头（凭据只在修改器里出现一次）。 */
  authHeaders: Record<string, string>
  rules: readonly RequestRewriteRule[]
  onRewriteEvaluated(result: RewriteEvaluation): void
}

/**
 * 请求侧修改器：拼出一条真正能发往上游的请求。
 *
 * 顺序固定为「头 → 正文 → 规则」：
 * 1. 头：丢掉客户端的认证与逐跳头，换上上游认证；正文长度在传输层还会再校正一次。
 * 2. 正文：模型改写 + 请求默认值 + 协议转换，都在适配器里一次做完。
 * 3. 规则：用户配置在最后介入，改的是「已经属于上游协议」的报文。
 *
 * 三个修改器都**不声明 `scope`**，因为这里没有可排除的形态：交付方式说的是响应怎么交付
 * （§1.6.1），而请求总是整份读完再发；载体在客户端跳是事实、在上游跳是规划器的决策，
 * 没有一个能构成「这个修改器在某种形态下没有能做的事」。
 */
export function createRequestModifiers(options: RequestModifierOptions): Modifier[] {
  return [
    createUpstreamHeadersModifier(options),
    createBodyPrepareModifier(options),
    createRequestRewriteModifier(options),
  ]
}

function createUpstreamHeadersModifier(options: RequestModifierOptions): Modifier {
  return {
    id: 'upstream-headers',
    order: 10,
    direction: 'request',
    frameMode: 'buffered',
    match: () => true,
    applyBuffered(context: ModifierContext, payload) {
      return {
        body: payload.body,
        headers: createUpstreamRequestHeaders(context.exchange.headers, options.authHeaders, payload.body.length),
      }
    },
  }
}

function createBodyPrepareModifier(options: RequestModifierOptions): Modifier {
  return {
    id: 'body-prepare',
    order: 20,
    direction: 'request',
    frameMode: 'buffered',
    match: () => true,
    applyBuffered(_context: ModifierContext, payload) {
      // 适配器读的是客户端原文，不是上一步的产物：模型改写与协议转换都以原始请求为输入。
      return { body: options.adapter.prepareRequest(options.requestContext, options.providerModelName), headers: payload.headers }
    },
  }
}

function createRequestRewriteModifier(options: RequestModifierOptions): Modifier {
  return {
    id: 'request-rewrite',
    order: 30,
    direction: 'request',
    frameMode: 'buffered',
    match: () => true,
    applyBuffered(context: ModifierContext, payload) {
      const modified = applyRequestRewriteRules(payload.body, payload.headers, options.rules, {
        stage: 'request',
        clientProtocol: context.clientProtocol,
        upstreamProtocol: context.upstreamProtocol,
      })
      options.onRewriteEvaluated({
        appliedRuleIds: modified.appliedRuleIds,
        skippedRuleIds: modified.skippedRuleIds,
        bodyBytesBefore: payload.body.length,
        bodyBytesAfter: modified.body.length,
      })
      return { body: modified.body, headers: modified.headers }
    },
  }
}
