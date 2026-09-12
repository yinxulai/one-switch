/**
 * 协议转换器内部共享的 JSON 取值工具。
 *
 * 所有协议转换都直接处理未知形状的 JSON 报文，转换器必须对畸形输入保持容错：
 * 取值失败时返回 undefined / null，由调用方决定降级策略（丢弃或保持原样）。
 */

export type Json = Record<string, unknown>

/** 仅当值是非数组对象时返回它，否则返回 null。 */
export function asObject(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null
}

/** 仅当值是数组时返回它，否则返回空数组。 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 仅当值是非空字符串时返回它，否则返回 undefined。 */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 仅当值是有限数字时返回它，否则返回 undefined。 */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 仅当值是布尔值时返回它，否则返回 undefined。 */
export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/**
 * 将工具调用/结果的内容序列化为文本。
 * 字符串原样返回；数组递归提取文本块并用换行拼接；其他情况回退到 JSON。
 */
export function stringifyContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value
      .map(part => {
        const record = asObject(part)
        if (!record) return typeof part === 'string' ? part : ''
        const text = asString(record.text)
        if (text !== undefined) return text
        const output = asString(record.output)
        if (output !== undefined) return output
        return ''
      })
      .filter(part => part.length > 0)
    return parts.join('\n')
  }
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

/** 安全的 JSON 解析：失败时返回传入的回退值。 */
export function safeJsonParse<T>(value: string | undefined, fallback: T): T {
  if (value === undefined) return fallback
  try {
    const parsed = JSON.parse(value) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}
