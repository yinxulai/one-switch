import { describe, expect, it } from 'vitest'
import { createDatabaseFileName, getMajorVersion } from './database-file'

describe('database file name', () => {
  it.each([
    ['1.0.0-rc.6', 1],
    ['1.0.0', 1],
    ['v2.3.4', 2],
    ['0.3.0-beta.1', 0],
    ['10', 10],
    ['  3.1.0  ', 3],
  ])('reads the major version from %s', (version, expected) => {
    expect(getMajorVersion(version)).toBe(expected)
  })

  it('rejects a version without a leading number instead of guessing one', () => {
    // 猜一个主版本号会静默指向另一个数据文件，宁可让打包流程立刻失败。
    expect(() => getMajorVersion('unknown')).toThrow('Cannot parse major version from app version: unknown')
  })

  it('puts the major version in the data file name', () => {
    expect(createDatabaseFileName('1.0.0-rc.6')).toBe('one-switch-v1.db')
    expect(createDatabaseFileName('2.0.0')).toBe('one-switch-v2.db')
  })

  it('keeps every patch and prerelease of one major version on the same file', () => {
    const names = ['1.0.0-rc.1', '1.0.0-rc.6', '1.0.0', '1.7.3'].map(createDatabaseFileName)

    expect(new Set(names)).toEqual(new Set(['one-switch-v1.db']))
  })
})
