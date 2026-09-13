import { describe, expect, it } from 'vitest'
import { buildCurl } from './build-curl'

describe('buildCurl', () => {
  it('拼出方法、地址、头与正文', () => {
    const command = buildCurl({
      url: 'http://127.0.0.1:9300/v1/chat/completions',
      method: 'post',
      headers: JSON.stringify({ 'content-type': 'application/json', accept: 'application/json' }),
      body: '{"model":"gpt-4o"}',
    })

    expect(command).toBe([
      'curl -X POST',
      "  'http://127.0.0.1:9300/v1/chat/completions'",
      "  -H 'content-type: application/json'",
      "  -H 'accept: application/json'",
      '  --data-raw \'{"model":"gpt-4o"}\'',
    ].join(' \\\n'))
  })

  it('正文里的单引号与换行原样保留', () => {
    const body = '{\n  "text": "it\'s a \\"test\\"",\n  "shell": "$HOME `date`"\n}'
    const command = buildCurl({ url: 'http://x/y', method: 'POST', headers: null, body })

    // 单引号被替换成 '\''，其余字符一个都不能动。
    expect(command).toContain(`--data-raw '{\n  "text": "it'\\''s a \\"test\\"",\n  "shell": "$HOME \`date\`"\n}'`)
  })

  it('多值头会展开成多条 -H', () => {
    const command = buildCurl({
      url: 'http://x/y',
      method: 'GET',
      headers: JSON.stringify({ 'x-tag': ['a', 'b'] }),
      body: null,
    })

    expect(command).toContain("-H 'x-tag: a'")
    expect(command).toContain("-H 'x-tag: b'")
    expect(command).not.toContain('--data-raw')
  })

  it('丢掉 curl 自己会算的头，避免与 --data-raw 打架', () => {
    const command = buildCurl({
      url: 'http://x/y',
      method: 'POST',
      headers: JSON.stringify({ Host: 'x', 'Content-Length': '12', Connection: 'keep-alive', 'x-real': '1' }),
      body: 'abc',
    })

    expect(command).not.toContain('Host:')
    expect(command).not.toContain('Content-Length:')
    expect(command).not.toContain('Connection:')
    expect(command).toContain("-H 'x-real: 1'")
  })

  it('头不是合法 JSON、方法为空、正文为空串都不报错', () => {
    expect(buildCurl({ url: 'http://x/y', method: '', headers: 'not-json', body: '' }))
      .toBe("curl -X POST \\\n  'http://x/y'")
  })
})
