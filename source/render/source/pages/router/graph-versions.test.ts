import { describe, expect, it } from 'vitest'

import { formatVersionTime, toRouterGraphVersion, toRouterGraphVersions } from './graph-versions'

describe('router 图版本展示模型', () => {
  it('把服务端摘要翻成列表要用的形状', () => {
    const version = toRouterGraphVersion({ version: 7, name: '命中分流', description: '按 UA 分流', savedAt: Date.parse('2026-09-11T14:41:05.000Z'), nodeCount: 4 })

    expect(version.id).toBe('version-7')
    // 版本号既是列表里的显示序号，也是恢复这一版时要传的号，必须同一个来源
    expect(version.sequence).toBe(7)
    expect(version.name).toBe('命中分流')
    expect(version.description).toBe('按 UA 分流')
    expect(version.savedAt).toBe('2026-09-11T14:41:05.000Z')
    expect(version.nodeCount).toBe(4)
  })

  it('没起名就是空串，版本号不塞进名字里', () => {
    const version = toRouterGraphVersion({ version: 3, name: '', description: '', savedAt: 0, nodeCount: 2 })

    // 版本号有自己的字段（`sequence`），名字不该被它占位。
    expect(version.name).toBe('')
    expect(version.sequence).toBe(3)
  })

  it('摘要列表按服务端给的顺序逐一转换', () => {
    const versions = toRouterGraphVersions([
      { version: 3, name: 'c', description: '', savedAt: 1_700_000_000_000, nodeCount: 5 },
      { version: 2, name: 'b', description: '', savedAt: 1_600_000_000_000, nodeCount: 4 },
    ])

    expect(versions.map(version => version.sequence)).toEqual([3, 2])
  })

  it('时间格式化按分钟精度输出，非法输入原样返回', () => {
    expect(formatVersionTime('2026-09-11T14:41:05.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(formatVersionTime('not-a-date')).toBe('not-a-date')
  })
})
