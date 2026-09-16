import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { packBody, unpackBody } from './stored-body'

/** 造一段确定性的高熵文本：哈希十六进制串，没有任何可重复利用的结构。 */
function highEntropyText(characterCount: number): string {
  let text = ''
  for (let counter = 0; text.length < characterCount; counter += 1) {
    text += createHash('sha256').update(String(counter)).digest('hex')
  }
  return text.slice(0, characterCount)
}

/** 造一段可压缩文本：内容重复，压完应当显著变小。 */
function compressibleText(repeatCount: number): string {
  return JSON.stringify({ messages: Array.from({ length: repeatCount }, () => ({ role: 'user', content: '请把这段文本原样返回，不要改写任何字符。' })) })
}

describe('正文落库前的压缩', () => {
  it('空正文原样穿过', () => {
    expect(packBody(null)).toBeNull()
    expect(unpackBody(null)).toBeNull()
    expect(unpackBody(undefined)).toBeNull()
  })

  it('小正文保持纯文本', () => {
    const stored = packBody('{"model":"gpt"}')

    expect(typeof stored).toBe('string')
    expect(unpackBody(stored)).toBe('{"model":"gpt"}')
  })

  it('刚好不到门槛的正文仍然保持纯文本', () => {
    const body = 'a'.repeat(511)

    expect(packBody(body)).toBe(body)
  })

  it('大正文压成字节，内容一字不差', () => {
    const body = compressibleText(200)
    const stored = packBody(body)

    expect(stored).toBeInstanceOf(Uint8Array)
    expect(stored).not.toBeInstanceOf(String)
    expect((stored as Uint8Array).length).toBeLessThan(Buffer.byteLength(body, 'utf8') / 2)
    expect(unpackBody(stored)).toBe(body)
  })

  it('中文与表情按字节压缩后仍能完整还原', () => {
    const body = `${compressibleText(20)}你好，世界 🌍 一🚀二🎯三`

    expect(unpackBody(packBody(body))).toBe(body)
  })

  it('落库结果永远不会比原文更大', () => {
    // 压缩的收益来自冗余，没冗余时必须退回原文——这条不变式一旦破了，正文会比不压缩更占地方。
    const bodies = ['', 'a'.repeat(511), highEntropyText(512), highEntropyText(2000), compressibleText(200)]

    for (const body of bodies) {
      const stored = packBody(body)
      const storedBytes = typeof stored === 'string' ? Buffer.byteLength(stored, 'utf8') : (stored?.length ?? 0)

      expect(storedBytes).toBeLessThanOrEqual(Buffer.byteLength(body, 'utf8'))
      expect(unpackBody(stored)).toBe(body)
    }
  })

  it('旧行里的纯文本不需要任何迁移就能读出来', () => {
    expect(unpackBody(compressibleText(200))).toBe(compressibleText(200))
  })

  it('遇到不是本项目写下的值会直接报错，而不是假装正文为空', () => {
    expect(() => unpackBody(42)).toThrowError(/Unexpected stored body type/)
  })
})
