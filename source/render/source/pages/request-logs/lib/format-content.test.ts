import { describe, expect, it } from 'vitest'
import { formatContent, isLocalFailureBody } from './format-content'

describe('formatContent', () => {
  it('restores line breaks in captured streaming chunks', () => {
    const value = JSON.stringify({
      schemaVersion: 1,
      chunks: ['event: message\ndata: {"text":"hello"}\n\n', 'data: [DONE]\n\n'],
    })

    expect(formatContent(value)).toEqual({
      value: 'event: message\ndata: {"text":"hello"}\n\ndata: [DONE]\n\n',
      isJson: true,
    })
  })

  it('keeps regular JSON formatted and does not alter escaped content', () => {
    const value = JSON.stringify({ message: 'literal \\n text' })

    expect(formatContent(value)).toEqual({
      value: '{\n  "message": "literal \\\\n text"\n}',
      isJson: true,
    })
  })

  it('returns non-JSON content unchanged', () => {
    expect(formatContent('plain response')).toEqual({ value: 'plain response', isJson: false })
  })

  // 本地失败时上游一个字节都没回，正文里只有本地观察到的原因：它必须一眼可读，
  // 否则「连接的哪一步断了」还是看不出来。
  it('reads a local failure body as a failure reason', () => {
    const value = JSON.stringify({ localFailure: true, errorCode: 'UPSTREAM_ERROR', errorMessage: 'socket hang up' })

    expect(formatContent(value)).toEqual({ value: '上游没有返回任何响应：socket hang up（UPSTREAM_ERROR）', isJson: false })
    expect(isLocalFailureBody(value)).toBe(true)
  })

  it('does not treat other bodies as local failures', () => {
    expect(isLocalFailureBody(JSON.stringify({ localFailure: true, errorMessage: 'x' }))).toBe(true)
    expect(isLocalFailureBody(JSON.stringify({ message: 'ok' }))).toBe(false)
    expect(isLocalFailureBody(JSON.stringify({ localFailure: 'true' }))).toBe(false)
    expect(isLocalFailureBody('not json')).toBe(false)
    expect(isLocalFailureBody(null)).toBe(false)
  })
})
