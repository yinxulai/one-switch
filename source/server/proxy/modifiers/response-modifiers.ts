import type { Frame, HeadFrame, Modifier, ModifierContext } from '@server/proxy/contracts'
import type { RequestRewriteRule } from '@common/schemas'
import type { ProtocolAdapter, ProtocolConversionAdapter, StreamConverter } from '@server/proxy/protocols/shared/types'
import { isStreamingDelivery } from '@server/proxy/adapters/http-response-sink'
import { createDownstreamHeaders } from '@server/proxy/response/headers'
import { applyRequestRewriteRules } from '@server/proxy/request-rewrite/request-rewrite-engine'
import type { RewriteEvaluation } from './request-modifiers'

/**
 * 这次尝试要不要交付、算不算成功。
 *
 * 只有响应头落地之后才成立，因此用可变对象在头帧到达时填入；修改器在 `match` 里读它，
 * 于是「failover 的响应一个字节都不给客户端」「只有成功才做响应改写」都由这里决定，
 * 而不用在内核里到处传布尔值。
 */
export interface AttemptRouting {
  /** 响应是否交付客户端；failover 提前放弃时为 `false`。 */
  deliverable: boolean
  /** 上游是否成功返回（2xx）。 */
  successful: boolean
}

export interface ResponseModifierOptions {
  adapter: ProtocolAdapter
  routing: AttemptRouting
  rules: readonly RequestRewriteRule[]
  onRewriteEvaluated(result: RewriteEvaluation): void
  onConversionError(error: Error): void
}

/**
 * 响应侧修改器：把上游报文变成客户端协议能收的东西。
 *
 * 顺序固定为「出口头 → 协议转换 → 响应改写」：
 * 1. 出口头：剥掉逐跳头，并在正文会被重写时报「长度不再可信」，让 Node 重新分帧。
 * 2. 协议转换：只有客户端协议与上游协议不同、且这次响应要交付时才介入。
 * 3. 响应改写：用户规则在最后改「已经是客户端协议」的报文，且只改非流式成功响应。
 *
 * 改写会改响应头，因此它必须把头部帧一起扣住，直到正文就绪再一并交出——否则出口
 * 已经按旧头开始写了。
 */
export function createResponseModifiers(options: ResponseModifierOptions): Modifier[] {
  return [
    createDownstreamHeadModifier(options),
    createConversionModifier(options),
    createResponseRewriteModifier(options),
  ]
}

function createDownstreamHeadModifier(options: ResponseModifierOptions): Modifier {
  const convertible = options.adapter.kind === 'conversion'
  return {
    id: 'downstream-head',
    order: 10,
    direction: 'response',
    frameMode: 'frame',
    match: (context: ModifierContext) => context.upstreamHead !== null,
    applyFrame(context: ModifierContext, frame: Frame) {
      if (frame.kind !== 'head') return frame
      const headers = createDownstreamHeaders(frame.headers)
      const streaming = isStreamingDelivery(context.exchange.delivery, frame.headers)
      // 正文可能被转换或改写，`content-length` 已经不是上游那个长度了。
      if (convertible || !streaming) delete headers['content-length']
      return { kind: 'head', status: frame.status, headers }
    },
  }
}

function createConversionModifier(options: ResponseModifierOptions): Modifier {
  // 原生直通时没有转换器：整条链路退化成「什么都不做」。
  const adapter = options.adapter.kind === 'conversion' ? options.adapter : null
  let streamConverter: StreamConverter | null = null
  let wholeBody = ''
  return {
    id: 'protocol-conversion',
    order: 20,
    direction: 'response',
    frameMode: 'frame',
    match: (context: ModifierContext) => adapter !== null && options.routing.deliverable && context.upstreamHead !== null,
    applyFrame(context: ModifierContext, frame: Frame): Frame | readonly Frame[] | null {
      if (!adapter) return frame
      const head = context.upstreamHead as HeadFrame
      if (!isStreamingDelivery(context.exchange.delivery, head.headers)) return accumulateWholeBody(adapter, frame)
      return convertStream(adapter, frame)
    },
  }

  function accumulateWholeBody(adapter: ProtocolConversionAdapter, frame: Frame): Frame | readonly Frame[] | null {
    if (frame.kind === 'data') {
      wholeBody += frame.body.toString('utf8')
      return null
    }
    if (frame.kind !== 'end') return frame
    if (!wholeBody) return frame
    const raw = Buffer.from(wholeBody)
    // 整体转换只在拿到完整正文后做一次；转不动就退回原文，绝不让客户端收到空响应。
    try {
      return [{ kind: 'data', body: adapter.convertResponse(raw) }, frame]
    } catch (error) {
      options.onConversionError(error instanceof Error ? error : new Error(String(error)))
      return [{ kind: 'data', body: raw }, frame]
    }
  }

  function convertStream(adapter: ProtocolConversionAdapter, frame: Frame): Frame | readonly Frame[] | null {
    if (frame.kind === 'head') return frame
    if (frame.kind === 'data') {
      const converted = requireConverter(adapter).push(frame.body.toString('utf8'))
      return converted ? [{ kind: 'data', body: Buffer.from(converted) }] : null
    }
    if (frame.kind !== 'end') return frame
    const converter = requireConverter(adapter)
    const tail = adapter.finishStream(converter)
    return tail ? [{ kind: 'data', body: Buffer.from(tail) }, frame] : frame
  }

  function requireConverter(adapter: ProtocolConversionAdapter): StreamConverter {
    const existing = streamConverter
    if (existing) return existing
    const created = adapter.createStreamConverter()
    streamConverter = created
    return created
  }
}

function createResponseRewriteModifier(options: ResponseModifierOptions): Modifier {
  let head: HeadFrame | null = null
  let body = ''
  return {
    id: 'response-rewrite',
    order: 30,
    direction: 'response',
    frameMode: 'frame',
    match: (context: ModifierContext) => {
      const upstream = context.upstreamHead
      if (!upstream || !options.routing.successful) return false
      // 增量交付的响应只有分块、没有完整正文，逐块改写会破坏 SSE 语义，因此整体跳过。
      return !isStreamingDelivery(context.exchange.delivery, upstream.headers)
    },
    applyFrame(context: ModifierContext, frame: Frame): Frame | readonly Frame[] | null {
      if (frame.kind === 'head') {
        head = frame
        return null
      }
      if (frame.kind === 'data') {
        body += frame.body.toString('utf8')
        return null
      }
      if (frame.kind !== 'end') return frame
      const upstreamHeaders = head?.headers ?? {}
      const modified = applyRequestRewriteRules(Buffer.from(body), upstreamHeaders, options.rules, {
        stage: 'response',
        clientProtocol: context.clientProtocol,
        upstreamProtocol: context.upstreamProtocol,
        // 由出口的合成事实推导，而不是断言 `false`：改写的前提就是「手里是完整正文」。
        incrementalDelivery: isStreamingDelivery(context.exchange.delivery, upstreamHeaders),
      })
      options.onRewriteEvaluated({
        appliedRuleIds: modified.appliedRuleIds,
        skippedRuleIds: modified.skippedRuleIds,
        bodyBytesBefore: body.length,
        bodyBytesAfter: modified.body.length,
      })
      const emitted: Frame[] = []
      if (head) emitted.push({ ...head, headers: modified.headers })
      emitted.push({ kind: 'data', body: modified.body })
      emitted.push(frame)
      return emitted
    },
  }
}
