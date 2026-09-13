import { asArray, asNumber, asObject, asString, stringifyContent, type Json } from './conversion-utils'

/**
 * OpenAI Responses 请求 → OpenAI Chat Completions 请求。
 *
 * Responses 的 `input` 是「输入项列表」（EasyInputMessage / function_call /
 * function_call_output / reasoning / item_reference 等），与 Chat Completions 的
 * `messages` 不是一一对应，需要按项类型分别映射：
 * - EasyInputMessage / message ↔ 普通 message
 * - 连续的 function_call ↔ 合并为一个 assistant 消息的 `tool_calls`
 * - function_call_output ↔ `role: tool` 消息
 * - reasoning / item_reference ↔ 丢弃（无对应语义）
 */

function responsesContentPartsToOpenAi(content: unknown): Json[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  const parts: Json[] = []
  for (const raw of asArray(content)) {
    const part = asObject(raw)
    if (!part) continue
    if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
      const text = asString(part.text)
      if (text === undefined) continue
      parts.push({ type: 'text', text, ...(part.prompt_cache_breakpoint ? { prompt_cache_breakpoint: part.prompt_cache_breakpoint } : {}) })
    } else if (part.type === 'input_image') {
      const imageUrl = asString(part.image_url) ?? asString(asObject(part.image_url)?.url)
      if (imageUrl) parts.push({ type: 'image_url', image_url: { url: imageUrl }, ...(part.prompt_cache_breakpoint ? { prompt_cache_breakpoint: part.prompt_cache_breakpoint } : {}) })
    }
    // input_file / input_audio / refusal 等无对应能力，丢弃
  }
  return parts
}

function partsToMessageContent(parts: Json[]): string | Json[] | null {
  if (parts.length === 0) return null
  if (parts.length === 1 && parts[0].type === 'text' && parts[0].prompt_cache_breakpoint === undefined) {
    return parts[0].text as string
  }
  return parts
}

function responsesToolToOpenAi(raw: unknown): Json | null {
  const tool = asObject(raw)
  if (tool?.type !== 'function') return null
  const name = asString(tool.name)
  if (!name) return null
  return {
    type: 'function',
    function: {
      name,
      description: asString(tool.description) ?? '',
      parameters: asObject(tool.parameters) ?? { type: 'object', properties: {} },
      ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
    },
  }
}

function responsesToolChoiceToOpenAi(choice: unknown): unknown {
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice
  const record = asObject(choice)
  if (!record) return undefined
  if (record.type === 'function' && asString(record.name)) {
    return { type: 'function', function: { name: record.name } }
  }
  return undefined
}

function responsesTextFormatToResponseFormat(text: unknown): Json | undefined {
  const format = asObject(asObject(text)?.format)
  if (!format) return undefined
  if (format.type === 'json_object') return { type: 'json_object' }
  if (format.type === 'json_schema' && asString(format.name)) {
    const schema = asObject(format.schema) ?? {}
    return {
      type: 'json_schema',
      json_schema: {
        name: format.name,
        schema,
        ...(typeof format.strict === 'boolean' ? { strict: format.strict } : {}),
        ...(asString(format.description) !== undefined ? { description: format.description } : {}),
      },
    }
  }
  return undefined
}

/** 追加 function_call 到上一条 assistant 消息，或新建一条。 */
function appendFunctionCall(messages: Json[], call: Json): void {
  const last = asObject(messages[messages.length - 1])
  if (last?.role === 'assistant' && last.content === null && Array.isArray(last.tool_calls)) {
    ;(last.tool_calls as Json[]).push(call)
    return
  }
  messages.push({ role: 'assistant', content: null, tool_calls: [call] })
}

function functionCallToToolCall(source: Json): Json | null {
  const name = asString(source.name)
  if (!name) return null
  const args = source.arguments
  return {
    id: asString(source.call_id) ?? asString(source.id) ?? '',
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) },
  }
}

function pushToolOutput(messages: Json[], source: Json): void {
  messages.push({ role: 'tool', tool_call_id: asString(source.call_id) ?? '', content: stringifyContent(source.output) })
}

function pushRoleMessage(role: string, content: string | Json[] | null, messages: Json[]): void {
  if (content === null) return
  if (role === 'system' || role === 'developer') {
    messages.push({ role: 'system', content })
    return
  }
  messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content })
}

/**
 * 处理 message 项的内容。Responses 规范把 function_call / function_call_output 定义为
 * 顶层输入项，但历史客户端（以及本仓库既有用例）会把它们嵌在 content 数组里，
 * 因此两种形态都要支持：遇到工具项时先冲刷已缓冲的普通内容，保证顺序不变。
 */
function convertMessageContent(role: string, content: unknown, messages: Json[]): void {
  if (typeof content === 'string') {
    if (content) pushRoleMessage(role, content, messages)
    return
  }
  let buffered: Json[] = []
  const flush = (): void => {
    if (buffered.length === 0) return
    pushRoleMessage(role, partsToMessageContent(buffered), messages)
    buffered = []
  }
  for (const rawPart of asArray(content)) {
    const part = asObject(rawPart)
    if (!part) continue
    if (part.type === 'function_call') {
      flush()
      const call = functionCallToToolCall(part)
      if (call) appendFunctionCall(messages, call)
      continue
    }
    if (part.type === 'function_call_output') {
      flush()
      pushToolOutput(messages, part)
      continue
    }
    buffered.push(...responsesContentPartsToOpenAi([rawPart]))
  }
  flush()
}

function convertInputItem(item: unknown, messages: Json[]): void {
  if (typeof item === 'string') {
    if (item) messages.push({ role: 'user', content: item })
    return
  }
  const record = asObject(item)
  if (!record) return

  if (record.type === 'function_call') {
    const call = functionCallToToolCall(record)
    if (call) appendFunctionCall(messages, call)
    return
  }
  if (record.type === 'function_call_output') {
    pushToolOutput(messages, record)
    return
  }
  if (record.type === 'reasoning' || record.type === 'item_reference') return

  const role = asString(record.role)
  if (!role) return
  convertMessageContent(role, record.content, messages)
}

export function responsesToOpenAiRequest(body: Json, model: string): Json {
  const messages: Json[] = []
  const instructions = asString(body.instructions)
  if (instructions) messages.push({ role: 'system', content: instructions })

  if (typeof body.input === 'string') {
    if (body.input) messages.push({ role: 'user', content: body.input })
  } else {
    for (const item of asArray(body.input)) convertInputItem(item, messages)
  }

  const result: Json = { model, messages }

  for (const field of ['prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options', 'metadata', 'user', 'parallel_tool_calls'] as const) {
    if (body[field] !== undefined) result[field] = body[field]
  }

  const maxTokens = asNumber(body.max_output_tokens)
  if (maxTokens !== undefined) result.max_tokens = maxTokens
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true

  const effort = asString(asObject(body.reasoning)?.effort)
  if (effort) result.reasoning_effort = effort

  const tools = asArray(body.tools)
    .map(responsesToolToOpenAi)
    .filter((tool): tool is Json => tool !== null)
  if (tools.length > 0) result.tools = tools

  const toolChoice = responsesToolChoiceToOpenAi(body.tool_choice)
  if (toolChoice !== undefined) result.tool_choice = toolChoice

  const responseFormat = responsesTextFormatToResponseFormat(body.text)
  if (responseFormat) result.response_format = responseFormat

  return result
}
