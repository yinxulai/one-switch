import { describe, expect, it } from 'vitest'
import { findTextMatches, searchBlocks, splitByMatches } from './content-search'

describe('findTextMatches', () => {
  it('finds every occurrence case-insensitively', () => {
    expect(findTextMatches('Tool, tool, TOOL', 'tool')).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
      { start: 12, end: 16 },
    ])
  })

  it('ignores empty queries and blocks', () => {
    expect(findTextMatches('content', '   ')).toEqual([])
    expect(findTextMatches('', 'content')).toEqual([])
  })

  it('treats the query as literal text rather than a pattern', () => {
    expect(findTextMatches('a.c abc', 'a.c')).toEqual([{ start: 0, end: 3 }])
  })
})

describe('splitByMatches', () => {
  it('splits text around matches and numbers them globally', () => {
    const text = 'aXbXc'

    expect(splitByMatches(text, findTextMatches(text, 'x'), 2)).toEqual([
      { text: 'a', matchIndex: null },
      { text: 'X', matchIndex: 2 },
      { text: 'b', matchIndex: null },
      { text: 'X', matchIndex: 3 },
      { text: 'c', matchIndex: null },
    ])
  })

  it('keeps the text whole when there is no match', () => {
    expect(splitByMatches('abc', [], 0)).toEqual([{ text: 'abc', matchIndex: null }])
  })
})

describe('searchBlocks', () => {
  it('orders matches by block and keeps them across the whole chain', () => {
    const result = searchBlocks(
      [
        { id: 'a', text: 'model=gpt-4' },
        { id: 'b', text: 'nothing here' },
        { id: 'c', text: 'model=gpt-4o' },
      ],
      'model',
    )

    expect(result.matches).toEqual([
      { sectionId: 'a' },
      { sectionId: 'c' },
    ])
    expect(result.highlights.get('a')?.count).toBe(1)
    expect(result.highlights.has('b')).toBe(false)
    expect(result.highlights.get('c')?.segments).toEqual([
      { text: 'model', matchIndex: 1 },
      { text: '=gpt-4o', matchIndex: null },
    ])
  })

  it('returns nothing for an empty query', () => {
    const result = searchBlocks([{ id: 'a', text: 'model' }], '  ')

    expect(result.matches).toEqual([])
    expect(result.highlights.size).toBe(0)
  })
})
