import { describe, expect, it } from 'vitest'

import { createDefaultGraph } from './graph-model'
import {
  MAX_ROUTER_VERSIONS,
  appendVersion,
  createVersion,
  formatVersionTime,
  isSameGraph,
  nextSequence,
  parseVersions,
} from './graph-versions'

const savedAt = new Date('2026-09-11T14:41:05.000Z')

describe('router 图历史版本', () => {
  it('版本号在最新版本上递增，没有版本时从 v1 开始', () => {
    expect(nextSequence([])).toBe(1)

    const graph = createDefaultGraph()
    const first = createVersion(graph, nextSequence([]), savedAt)
    const second = createVersion(graph, nextSequence([first]), savedAt)

    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
  })

  it('快照记录保存时间与节点数量', () => {
    const graph = createDefaultGraph()
    const version = createVersion(graph, 3, savedAt)

    expect(version.sequence).toBe(3)
    expect(version.graph).toBe(graph)
    expect(version.nodeCount).toBe(graph.nodes.length)
    expect(version.savedAt).toBe(savedAt.toISOString())
    expect(version.id).toContain(String(savedAt.getTime()))
  })

  it('新版本置顶，超过上限时丢弃最旧的', () => {
    const graph = createDefaultGraph()
    const first = createVersion(graph, 1, savedAt)
    const second = createVersion(graph, 2, savedAt)
    const third = createVersion(graph, 3, savedAt)

    const versions = appendVersion(appendVersion(appendVersion([], first), second), third)

    expect(versions.map(version => version.sequence)).toEqual([3, 2, 1])
    expect(appendVersion(appendVersion([], first), second, 1).map(version => version.sequence)).toEqual([2])
    expect(MAX_ROUTER_VERSIONS).toBeGreaterThan(1)
  })

  it('内容一致时判定为同一个版本，避免保存出重复项', () => {
    const graph = createDefaultGraph()
    const sameShape = { ...graph, nodes: graph.nodes.map(node => ({ ...node })) }

    expect(isSameGraph(graph, sameShape)).toBe(true)
    // createDefaultGraph() 每次都会生成新的节点 id，因此只有重新解析过的同一张图才算「内容一致」
    expect(isSameGraph(graph, { ...graph, nodes: graph.nodes.slice(0, -1) })).toBe(false)
  })

  it('解析时丢弃损坏的条目，只保留通过 schema 的版本', () => {
    const graph = createDefaultGraph()
    const valid = createVersion(graph, 7, savedAt)

    expect(parseVersions(null)).toEqual([])
    expect(parseVersions({})).toEqual([])

    const parsed = parseVersions([
      valid,
      'not-an-object',
      { savedAt: savedAt.toISOString(), graph: { nodes: 'broken' } },
      { graph },
      { savedAt: savedAt.toISOString(), id: '', sequence: 'x', graph },
    ])

    expect(parsed).toHaveLength(2)
    expect(parsed[0]?.id).toBe(valid.id)
    // 缺失 / 非法 sequence 时按出现顺序补号，不会污染已有版本号
    expect(parsed[1]?.sequence).toBe(2)
    expect(parsed[1]?.nodeCount).toBe(graph.nodes.length)
  })

  it('时间格式化按 分钟 精度输出，非法输入原样返回', () => {
    expect(formatVersionTime(savedAt.toISOString())).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(formatVersionTime('not-a-date')).toBe('not-a-date')
  })
})
