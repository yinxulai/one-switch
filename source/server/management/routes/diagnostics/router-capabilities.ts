import { createContext, Script } from 'node:vm'
import type { Protocol } from '@common/schemas'
import { generateId } from '@common/utils'
import { getByPath } from '@render/source/pages/router/engine'
import type {
  PromptInvocation,
  PromptInvocationResult,
  RunCapabilities,
  ScriptInvocation,
  ScriptInvocationResult,
  WorkflowProtocol,
} from '@render/source/pages/router/types'
import { executeProxyRequest } from '../../../proxy/execution/attempt-executor'
import { createRequestContext } from '../../../proxy/request/request-context'
import { BufferedProxyResponse } from '../../../proxy/response/proxy-response'
import { resolveAttemptSnapshot, resolveProxyTargets } from '../../../proxy/routing/routing'

/**
 * 会话能力（沙箱 / LLM 调用）的服务端实现。
 *
 * 引擎在 `@render` 下，但它需要「网络」和「隔离运行时」这类只有主进程才有的资源，
 * 因此引擎只声明 `RunCapabilities` 接口，由这里注入具体实现：
 * 渲染进程复用同一份引擎代码做静态推演时，这些节点会明确报「能力未注入」，而不是静默跳过。
 */

const SCRIPT_LOG_LIMIT = 50

/** 提示词调用用的客户端协议：请求协议不是聊天协议时，按 openai-completions 调用。 */
function promptProtocol(protocol: WorkflowProtocol): Protocol {
  if (protocol === 'openai-completions' || protocol === 'openai-responses' || protocol === 'anthropic-messages') {
    return protocol
  }
  return 'openai-completions'
}

function buildPromptBody(protocol: Protocol, invocation: PromptInvocation): string {
  const messages = invocation.prompt ? [{ role: 'user', content: invocation.prompt }] : []
  const system = invocation.systemPrompt.trim()

  // `model` 只是占位：执行器会用上游模型名改写它（`rewriteRequestModel`）。
  if (protocol === 'openai-responses') {
    return JSON.stringify({
      model: invocation.logicalModelId,
      instructions: system || undefined,
      input: messages,
      temperature: invocation.temperature,
      max_output_tokens: invocation.maxTokens,
    })
  }

  if (protocol === 'anthropic-messages') {
    return JSON.stringify({
      model: invocation.logicalModelId,
      system: system || undefined,
      messages,
      temperature: invocation.temperature,
      max_tokens: invocation.maxTokens,
    })
  }

  return JSON.stringify({
    model: invocation.logicalModelId,
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    temperature: invocation.temperature,
    max_tokens: invocation.maxTokens,
  })
}

/** 取内容块文本：数组递归拼接，对象块读 `text`，标量直接转字符串。 */
function blockText(block: unknown): string {
  if (Array.isArray(block)) return block.map(blockText).filter(Boolean).join('')
  if (block && typeof block === 'object') return String((block as Record<string, unknown>).text ?? '')
  if (block === undefined || block === null) return ''
  return String(block)
}

function extractAnthropicReply(payload: Record<string, unknown>): string {
  const blocks = Array.isArray(payload.content) ? payload.content : []
  return blocks.map(blockText).filter(Boolean).join('')
}

function extractResponsesReply(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  const output = Array.isArray(payload.output) ? payload.output : []
  const texts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) texts.push(blockText(part))
  }
  return texts.filter(Boolean).join('')
}

function extractCompletionsReply(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const first = choices[0]
  if (!first || typeof first !== 'object') return ''
  const record = first as Record<string, unknown>
  const message = record.message
  if (!message || typeof message !== 'object') return blockText(record)
  return blockText(message)
}

/** 从各协议的回复体里取出正文：openai 取 `message.content`，anthropic 拼接 `content[].text`。 */
function extractReplyText(protocol: Protocol, payload: Record<string, unknown>): string {
  if (protocol === 'anthropic-messages') return extractAnthropicReply(payload)
  if (protocol === 'openai-responses') return extractResponsesReply(payload)
  return extractCompletionsReply(payload)
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** 沙箱只能交回可序列化的数据；这里做一次转换，顺手挡掉循环引用与宿主对象。 */
function toSerializable(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function formatLogArgument(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  const serialized = toSerializable(value)
  if (serialized === undefined) return String(value)
  return typeof serialized === 'string' ? serialized : JSON.stringify(serialized)
}

/**
 * 在 `node:vm` 上下文里执行用户脚本。
 *
 * 隔离策略：
 * - 不给 `require` / `process` / 定时器 / 网络 / 文件系统，只有数据 + `get()` + 受控 `console`；
 * - 关闭 `eval` / `new Function`（`codeGeneration.strings = false`）与 WASM 编译；
 * - 每次执行都有 `timeout`，死循环会被中断而不是挂住主进程。
 */
function executeScript(invocation: ScriptInvocation): ScriptInvocationResult {
  const startedAt = Date.now()
  const logs: string[] = []
  const pushLog = (level: string, args: unknown[]) => {
    if (logs.length >= SCRIPT_LOG_LIMIT) return
    logs.push(`[${level}] ${args.map(formatLogArgument).join(' ')}`)
  }

  const sandbox = {
    payload: invocation.payload,
    get: (path: unknown) => getByPath(invocation.payload, String(path ?? '')),
    console: {
      log: (...args: unknown[]) => pushLog('log', args),
      warn: (...args: unknown[]) => pushLog('warn', args),
      error: (...args: unknown[]) => pushLog('error', args),
    },
  }

  try {
    const context = createContext(sandbox, {
      name: `router-script-${invocation.nodeId}`,
      codeGeneration: { strings: false, wasm: false },
    })
    const script = new Script(`"use strict";\n(function () {\n${invocation.code}\n})()`, {
      filename: `router-script-${invocation.nodeId}.js`,
    })
    const value = script.runInContext(context, { timeout: invocation.timeoutMilliseconds })
    return {
      success: true,
      value: toSerializable(value),
      logs,
      durationMilliseconds: Date.now() - startedAt,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      logs,
      error: message.includes('Script execution timed out')
        ? `脚本执行超时（> ${invocation.timeoutMilliseconds} ms），已中断`
        : message,
      durationMilliseconds: Date.now() - startedAt,
    }
  }
}

/** 用指定逻辑模型跑一次提示词：走的是和真实代理请求同一条通路（含协议转换、密钥、故障转移）。 */
async function executePrompt(invocation: PromptInvocation): Promise<PromptInvocationResult> {
  const startedAt = Date.now()
  const protocol = promptProtocol(invocation.protocol)
  const targets = await resolveProxyTargets(invocation.logicalModelId, protocol)

  if (targets.targets.length === 0) {
    return {
      success: false,
      text: '',
      error: `逻辑模型 ${invocation.logicalModelId} 没有支持 ${protocol} 的可用上游`,
      durationMilliseconds: Date.now() - startedAt,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), invocation.timeoutMilliseconds)

  try {
    const response = new BufferedProxyResponse()
    await executeProxyRequest({
      context: createRequestContext({
        requestId: generateId('req_'),
        logicalModelId: invocation.logicalModelId,
        clientProtocol: protocol,
        method: 'POST',
        path: `/router/prompt/${protocol}`,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        requestBody: Buffer.from(buildPromptBody(protocol, invocation)),
        signal: controller.signal,
      }),
      targets: targets.targets,
      response,
    })

    const durationMilliseconds = Date.now() - startedAt
    const target = resolveAttemptSnapshot(targets.targets[0], protocol)
    const targetLabel = `${target.providerName} / ${target.providerModelName}`

    if (response.statusCode < 200 || response.statusCode >= 400) {
      return {
        success: false,
        text: '',
        target: targetLabel,
        error: response.failureMessage ?? `上游返回 HTTP ${response.statusCode || 502}`,
        durationMilliseconds,
      }
    }

    const parsed = parseJsonObject(response.body)
    if (!parsed) {
      return {
        success: false,
        text: '',
        target: targetLabel,
        error: '上游返回的不是 JSON 对象',
        durationMilliseconds,
      }
    }

    return {
      success: true,
      text: extractReplyText(protocol, parsed),
      raw: parsed,
      target: targetLabel,
      durationMilliseconds,
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        success: false,
        text: '',
        error: `LLM 调用超时（> ${invocation.timeoutMilliseconds} ms），已中断`,
        durationMilliseconds: Date.now() - startedAt,
      }
    }
    return {
      success: false,
      text: '',
      error: error instanceof Error ? error.message : String(error),
      durationMilliseconds: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 供路由执行入口使用的能力集合。 */
export function createRouterCapabilities(): RunCapabilities {
  return {
    runScript: (invocation) => Promise.resolve(executeScript(invocation)),
    runPrompt: executePrompt,
  }
}
