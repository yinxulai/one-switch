import { describe, expect, it } from 'vitest'
import { applyOpenAiResponsesRequestDefaults } from './request-defaults'

/**
 * OpenAI Responses 请求体默认值。
 *
 * 这一段是纯函数：代理转发前把「流式但没要用量」的请求补上 `stream_options.include_usage`，
 * 让上游把 token 用量一起回给计费/统计。补不上（非流式、体不是对象、已经要过）时必须
 * **原样返回**，绝不能把用户请求改坏。
 */

function apply(payload: unknown): unknown {
  return JSON.parse(applyOpenAiResponsesRequestDefaults(Buffer.from(JSON.stringify(payload))).toString('utf8'))
}

describe('applyOpenAiResponsesRequestDefaults', () => {
  it('空请求体原样返回同一份 buffer', () => {
    const body = Buffer.alloc(0)
    expect(applyOpenAiResponsesRequestDefaults(body)).toBe(body)
  })

  it('非 JSON 请求体原样返回', () => {
    const body = Buffer.from('not json at all')
    expect(applyOpenAiResponsesRequestDefaults(body)).toBe(body)
  })

  it('JSON 不是对象（数组 / null / 标量）时原样返回', () => {
    for (const raw of ['[]', 'null', '"a string"', '42', 'true']) {
      const body = Buffer.from(raw)
      expect(applyOpenAiResponsesRequestDefaults(body)).toBe(body)
    }
  })

  it('非流式请求不补用量选项', () => {
    const body = Buffer.from(JSON.stringify({ model: 'gpt-4o', stream: false }))
    expect(applyOpenAiResponsesRequestDefaults(body)).toBe(body)
    expect(apply({ model: 'gpt-4o' })).toEqual({ model: 'gpt-4o' })
  })

  it('已经要过用量时原样返回', () => {
    const body = Buffer.from(JSON.stringify({ stream: true, stream_options: { include_usage: true } }))
    expect(applyOpenAiResponsesRequestDefaults(body)).toBe(body)
  })

  it('流式且没有 stream_options 时补上一份', () => {
    expect(apply({ model: 'gpt-4o', stream: true })).toEqual({
      model: 'gpt-4o',
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('流式且已有 stream_options 对象时只并入 include_usage，保留其它选项', () => {
    expect(apply({ stream: true, stream_options: { foo: 'bar' } })).toEqual({
      stream: true,
      stream_options: { foo: 'bar', include_usage: true },
    })
  })

  it('stream_options 不是对象时整块替换', () => {
    expect(apply({ stream: true, stream_options: 'nope' })).toEqual({
      stream: true,
      stream_options: { include_usage: true },
    })
    expect(apply({ stream: true, stream_options: null })).toEqual({
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('只补用量，不动请求体里的其它字段', () => {
    const payload = { model: 'gpt-4o', stream: true, input: [{ role: 'user', content: 'hi' }] }
    expect(apply(payload)).toEqual({ ...payload, stream_options: { include_usage: true } })
  })
})
