import { describe, expect, it } from 'vitest'
import { createScriptRoutingGraph } from '@common/router/presets'
import type { ScriptInvocationResult } from '@common/router/types'
import { executeRouteScript } from './script-sandbox'

/**
 * 脚本沙箱回归测试。
 *
 * 这里跑的是**内置「脚本分流」预设里那段真实的代码**：引擎侧的脚本节点测试全都注入假的
 * `runScript`，只比对代码文本 —— 「换一种协议就静默读错字段」这类问题一个都拦不住。
 * 沙箱本身只依赖 `node:vm`，所以可以脱离代理执行栈单独跑。
 */

/** 取预设里脚本节点的代码：用户套用「脚本分流」后实际会跑的那一段。 */
function presetScriptCode(): string {
  const node = createScriptRoutingGraph([]).nodes.find(item => item.kind === 'script')
  if (!node || node.kind !== 'script') throw new Error('脚本分流预设里没有脚本节点')
  return node.code
}

function runPresetScript(payload: Record<string, unknown>): ScriptInvocationResult {
  return executeRouteScript({
    nodeId: 'complexity-script',
    nodeName: '复杂度判定',
    code: presetScriptCode(),
    payload,
    timeoutMilliseconds: 1_000,
  })
}

/** 探针调用：只关心沙箱边界，节点信息随便给一个。 */
function probe(code: string, timeoutMilliseconds: number): ScriptInvocationResult {
  return executeRouteScript({ nodeId: 'probe', nodeName: '探针', code, payload: {}, timeoutMilliseconds })
}

describe('脚本沙箱', () => {
  it('沙箱里没有 require，也造不出新代码，死循环会被超时中断', () => {
    const noRequire = probe('return typeof require', 200)
    expect(noRequire).toMatchObject({ success: true, value: 'undefined' })

    // 禁的是「用字符串造出可执行代码」，不是 `eval` 这个名字本身。
    const noEval = probe("return eval('1 + 1')", 200)
    expect(noEval.success).toBe(false)

    const loop = probe('while (true) {}', 50)
    expect(loop.success).toBe(false)
    expect(loop.error).toContain('timed out')
  })

  it('内置脚本预设按 route.protocol 决定读哪条消息路径', () => {
    // 体里两条路径同时存在：`messages` 是别处带来的残缺副本，这次请求真正生效的是 `input`。
    // 按「先 messages、取不到再 input」的兜底顺序会数出 9 条消息、判成复杂请求。
    const result = runPresetScript({
      route: { protocol: 'openai-responses' },
      request: {
        body: {
          messages: Array.from({ length: 9 }, (_, index) => ({ role: 'user', content: `噪音 ${index}` })),
          input: [{ role: 'user', content: '你好' }],
        },
      },
    })

    expect(result.success).toBe(true)
    expect(result.value).toBe('simple')
    // 打分过程照旧进日志，测试运行面板里能直接核对。
    expect(result.logs.join('\n')).toContain('messageCount')
  })

  it('内置脚本预设：completions / anthropic 下读 messages，消息多就是复杂请求', () => {
    for (const protocol of ['openai-completions', 'anthropic-messages']) {
      const result = runPresetScript({
        route: { protocol },
        request: {
          body: {
            input: [{ role: 'user', content: '不该被读' }],
            messages: Array.from({ length: 8 }, (_, index) => ({ role: 'user', content: `第 ${index} 条` })),
          },
        },
      })

      expect({ protocol, value: result.value }).toEqual({ protocol, value: 'complex' })
    }
  })

  it('内置脚本预设：认不出协议时不声称读到了消息，退化成整体长度而不是报错', () => {
    const result = runPresetScript({
      route: { protocol: 'unknown' },
      request: { body: { model: 'gpt-4o-mini' } },
    })

    expect(result.success).toBe(true)
    expect(result.value).toBe('simple')
    expect(result.logs.join('\n')).toContain('"messageCount":0')
  })

  it('脚本抛错时如实记账，不把异常带出沙箱', () => {
    const result = probe('throw new Error("炸了")', 200)
    expect(result.success).toBe(false)
    expect(result.error).toContain('炸了')
  })
})
