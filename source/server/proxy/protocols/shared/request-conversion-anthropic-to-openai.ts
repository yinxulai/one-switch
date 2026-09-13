import { asArray, asNumber, asObject, asString, type Json } from './conversion-utils'

/**
 * Anthropic Messages 请求 → OpenAI Chat Completions 请求。
 *
 * 字段映射遵循「保守转换」原则：无法映射的字段（top_k、document、thinking、
 * service_tier 等）直接丢弃，不报错也不伪造语义。
 * 关键映射：
 * - `system` ↔ 首条 `role: system` 消息；带 cache_control 时保留缓存断点
 * - `messages[].content` 的 text / image block ↔ OpenAI content parts
 * - assistant `tool_use` ↔ OpenAI `tool_calls`
 * - user `tool_result` ↔ OpenAI `role: tool` 消息，且保持对话顺序
 */

const CACHE_BREAKPOINT: Json = { mode: 'explicit' }

function cacheBreakpointFrom(cacheControl: unknown): Json | undefined {
  return asObject(cacheControl) ? CACHE_BREAKPOINT : undefined
}

/** Anthropic content block 数组 → OpenAI content parts（text / image_url）。 */
function blocksToOpenAiParts(content: unknown): Json[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  const parts: Json[] = []
  for (const raw of asArray(content)) {
    const block = asObject(raw)
    if (!block) continue
    if (block.type === 'text') {
      const text = asString(block.text)
      if (text === undefined) continue
      const breakpoint = cacheBreakpointFrom(block.cache_control)
      parts.push({ type: 'text', text, ...(breakpoint ? { prompt_cache_breakpoint: breakpoint } : {}) })
    } else if (block.type === 'image') {
      const source = asObject(block.source)
      if (!source) continue
      if (source.type === 'base64') {
        const mediaType = asString(source.media_type)
        const data = asString(source.data)
        if (mediaType && data) parts.push({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } })
      } else if (source.type === 'url') {
        const url = asString(source.url)
        if (url) parts.push({ type: 'image_url', image_url: { url } })
      }
      // source.type === 'file'（上传文件引用）无法在 OpenAI 侧复用，丢弃
    }
  }
  return parts
}

/** content parts → OpenAI message content（单段纯文本折叠为字符串）。 */
function partsToMessageContent(parts: Json[]): string | Json[] | null {
  if (parts.length === 0) return null
  if (parts.length === 1 && parts[0].type === 'text' && parts[0].prompt_cache_breakpoint === undefined) {
    return parts[0].text as string
  }
  return parts
}

/** assistant content 中的 tool_use blocks → OpenAI tool_calls。 */
function toolUsesToOpenAiToolCalls(content: unknown): Json[] {
  const calls: Json[] = []
  for (const raw of asArray(content)) {
    const block = asObject(raw)
    if (block?.type !== 'tool_use') continue
    const name = asString(block.name)
    if (!name) continue
    calls.push({
      id: asString(block.id) ?? '',
      type: 'function',
      function: { name, arguments: JSON.stringify(asObject(block.input) ?? {}) },
    })
  }
  return calls
}

/**
 * user content 中的 tool_result blocks → OpenAI tool 消息内容。
 * 纯文本折叠为字符串，含图片时保留为 content parts。
 */
function toolResultToOpenAiContent(content: unknown): string | Json[] {
  if (typeof content === 'string') return content
  const parts = blocksToOpenAiParts(content)
  const textOnly = parts.every(part => part.type === 'text')
  if (textOnly) return parts.map(part => asString(part.text) ?? '').join('')
  return parts
}

function anthropicToolToOpenAi(tool: Json): Json | null {
  const name = asString(tool.name)
  if (!name) return null
  return {
    type: 'function',
    function: {
      name,
      description: asString(tool.description) ?? '',
      parameters: asObject(tool.input_schema) ?? { type: 'object', properties: {} },
    },
  }
}

function anthropicToolChoiceToOpenAi(choice: unknown): unknown {
  const record = asObject(choice)
  if (!record) return undefined
  switch (record.type) {
    case 'auto': return 'auto'
    case 'any': return 'required'
    case 'none': return 'none'
    case 'tool':
      return asString(record.name) ? { type: 'function', function: { name: record.name } } : undefined
    default: return undefined
  }
}

export function anthropicToOpenAiRequest(body: Json, model: string): Json {
  const messages: Json[] = []

  // system：字符串或 TextBlockParam 数组
  if (typeof body.system === 'string') {
    if (body.system) messages.push({ role: 'system', content: body.system })
  } else if (Array.isArray(body.system)) {
    const parts = blocksToOpenAiParts(body.system)
    if (parts.length > 0) messages.push({ role: 'system', content: partsToMessageContent(parts) })
  }

  for (const raw of asArray(body.messages)) {
    const message = asObject(raw)
    if (!message) continue
    const role = asString(message.role)
    if (role === 'assistant') {
      const parts = blocksToOpenAiParts(message.content)
      const toolCalls = toolUsesToOpenAiToolCalls(message.content)
      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: partsToMessageContent(parts), tool_calls: toolCalls })
      } else {
        messages.push({ role: 'assistant', content: partsToMessageContent(parts) ?? '' })
      }
      continue
    }

    // user：tool_result 必须先于普通内容输出（OpenAI 要求 tool 消息紧随 assistant.tool_calls），
    // 因此同一条 user 消息内先发 tool 消息，再把剩余的 text/image block 合并成一条 user 消息。
    const toolMessages = asArray(message.content)
      .map(part => asObject(part))
      .filter((block): block is Json => block?.type === 'tool_result')
      .map(block => ({
        role: 'tool',
        tool_call_id: asString(block.tool_use_id) ?? '',
        content: toolResultToOpenAiContent(block.content),
      }))
    for (const toolMessage of toolMessages) messages.push(toolMessage)

    const parts = blocksToOpenAiParts(message.content)
    if (parts.length > 0) messages.push({ role: 'user', content: partsToMessageContent(parts) })
  }

  const result: Json = { model, messages }

  if (body.cache_control !== undefined) result.prompt_cache_options = { mode: 'implicit' }

  const tools = asArray(body.tools)
    .map(raw => anthropicToolToOpenAi(asObject(raw) ?? {}))
    .filter((tool): tool is Json => tool !== null)
  if (tools.length > 0) result.tools = tools

  const toolChoice = anthropicToolChoiceToOpenAi(body.tool_choice)
  if (toolChoice !== undefined) result.tool_choice = toolChoice
  // Anthropic 的 disable_parallel_tool_use 只在 auto/any/tool 变体上出现，语义等价于 OpenAI 的 parallel_tool_calls: false
  if (asObject(body.tool_choice)?.disable_parallel_tool_use === true) result.parallel_tool_calls = false

  const maxTokens = asNumber(body.max_tokens)
  if (maxTokens !== undefined) result.max_tokens = maxTokens
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true
  if (body.stop_sequences !== undefined) result.stop = body.stop_sequences

  const userId = asString(asObject(body.metadata)?.user_id)
  if (userId) result.user = userId

  return result
}
