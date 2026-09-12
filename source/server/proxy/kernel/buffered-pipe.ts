import type { BufferedPayload, Modifier, ModifierContext } from '@server/proxy/contracts'

export interface BufferedPipeInput {
  /** 进入上一个循环的载荷；请求方向就是客户端原文加原始头。 */
  readonly payload: BufferedPayload
  readonly context: ModifierContext
  /** 候选修改器；管道自己按 `direction` / `frameMode` / `match` 过滤并按 `order` 排序。 */
  readonly modifiers: readonly Modifier[]
}

export interface BufferedPipeResult {
  /** 处理完的载荷；被修改器丢弃时为 `null`。 */
  readonly payload: BufferedPayload | null
  readonly appliedModifierIds: readonly string[]
}

/**
 * 缓冲区管道：把整块载荷依次交给 `buffered` 修改器。
 *
 * 与帧管道相对：帧管道处理「已经开始的响应」，缓冲区管道处理「还没发出去的请求」——
 * 后者必须等所有修改器跑完才能发，否则发出去的就是半成品。两者共用的规则是
 * 「内核不解析字节」，解析全部发生在修改器里。
 */
export async function pipeBuffered(input: BufferedPipeInput): Promise<BufferedPipeResult> {
  const appliedModifierIds: string[] = []
  let payload = input.payload
  for (const modifier of selectBufferedModifiers(input.modifiers, input.context)) {
    if (!modifier.applyBuffered) continue
    const next = await modifier.applyBuffered(input.context, payload)
    if (next === null) return { payload: null, appliedModifierIds }
    payload = next
    appliedModifierIds.push(modifier.id)
  }
  return { payload, appliedModifierIds }
}

/** 参与本次管道的修改器：方向一致、缓冲区粒度、`match` 通过，按 `order` 升序（同值保持注册顺序）。 */
export function selectBufferedModifiers(modifiers: readonly Modifier[], context: ModifierContext): readonly Modifier[] {
  return modifiers
    .filter(modifier => modifier.direction === context.direction && modifier.frameMode === 'buffered' && modifier.match(context))
    .slice()
    .sort((left, right) => left.order - right.order)
}
