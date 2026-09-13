import { createContext, Script } from 'node:vm'
import { getByPath } from '@common/router/engine'
import type { ScriptInvocation, ScriptInvocationResult } from '@common/router/types'

/**
 * 脚本节点的隔离运行时。
 *
 * 单独成一个模块，是因为它**只依赖 `node:vm` 与路径取值**，与代理执行的其余部分
 * （数据库、上游规划、协议转换）没有任何关系。分开之后，内置脚本预设里的那段代码
 * 可以真的被跑一遍再断言结果 —— 脚本节点在引擎里的测试都注入假的 `runScript`，
 * 光比对代码文本是看不出「换个协议就读错了」的。
 */

/** 沙箱最多回传的日志行数：脚本里刷屏的 `console.log` 不能把 trace 撑爆。 */
const SCRIPT_LOG_LIMIT = 50

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
export function executeRouteScript(invocation: ScriptInvocation): ScriptInvocationResult {
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
        ? `Script execution timed out (> ${invocation.timeoutMilliseconds} ms), aborted`
        : message,
      durationMilliseconds: Date.now() - startedAt,
    }
  }
}
