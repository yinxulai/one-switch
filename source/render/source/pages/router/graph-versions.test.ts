import { describe, expect, it } from 'vitest'

import { formatVersionTime, toRouterGraphVersion, toRouterGraphVersions } from './graph-versions'

describe('router 图版本展示模型', () => {
  it('把服务端摘要翻成列表要用的形状', () => {
    const version = toRouterGraphVersion({ version: 7, name: '命中分流', savedAt: Date.parse('2026-09-11T14:41:05.000Z'), nodeCount: 4 })

    expect(version.id).toBe('version-7')
    // 版本号既是列表里的显示序号，也是恢复这一版时要传的号，必须同一个来源
    expect(version.sequence).toBe(7)
    expect(version.savedAt).toBe('2026-09-11T14:41:05.000Z')
    expect(version.nodeCount).toBe(4)
  })

  it('摘要列表按服务端给的顺序逐一转换', () => {
    const versions = toRouterGraphVersions([
      { version: 3, name: 'c', savedAt: 1_700_000_000_000, nodeCount: 5 },
      { version: 2, name: 'b', savedAt: 1_600_000_000_000, nodeCount: 4 },
    ])

    expect(versions.map(version => version.sequence)).toEqual([3, 2])
  })

  it('时间格式化按分钟精度输出，非法输入原样返回', () => {
    expect(formatVersionTime('2026-09-11T14:41:05.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(formatVersionTime('not-a-date')).toBe('not-a-date')
  })
})
