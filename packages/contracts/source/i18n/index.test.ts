import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTranslator,
  interpolate,
  isLocale,
  normalizeLocale,
  resolveLocale,
} from './index'
import { DEFAULT_LOCALE, type Catalog } from './types'

/**
 * i18n 核心。
 *
 * 只测这一层的**纯逻辑**：locale 收敛、插值、取词的回退链与复数选择。
 * 目录内容本身对不对属于 `catalogs.test.ts` 的事。
 */

const catalog: Catalog = {
  'app.title': 'One Switch',
  'app.greeting': '你好，{name}',
  'item.count': { one: '1 项', other: '{count} 项' },
  'item.noOther': { one: '只有单数' },
}

describe('locale helpers', () => {
  it('isLocale 只认目录里支持的语言', () => {
    expect(isLocale('zh-CN')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale(42)).toBe(false)
  })

  it('normalizeLocale 按主语言子标签收敛', () => {
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(normalizeLocale('zh-TW')).toBe('zh-CN')
    expect(normalizeLocale('ZH')).toBe('zh-CN')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('fr-FR')).toBeNull()
    expect(normalizeLocale('')).toBeNull()
    expect(normalizeLocale(null)).toBeNull()
    expect(normalizeLocale(undefined)).toBeNull()
  })

  it('resolveLocale 依次尝试偏好、系统语言，最后落到默认值', () => {
    expect(resolveLocale('en', 'zh-CN')).toBe('en')
    expect(resolveLocale('system', 'zh-CN')).toBe('zh-CN')
    expect(resolveLocale('fr', 'zh-CN')).toBe('zh-CN')
    expect(resolveLocale(null, 'en-GB')).toBe('en')
    expect(resolveLocale('fr', 'de')).toBe(DEFAULT_LOCALE)
    expect(resolveLocale(undefined, undefined)).toBe(DEFAULT_LOCALE)
  })

  it('interpolate 替换占位符，缺参数时原样保留', () => {
    expect(interpolate('你好，{name}', { name: '小明' })).toBe('你好，小明')
    expect(interpolate('{a}-{b}', { a: 1, b: 2 })).toBe('1-2')
    expect(interpolate('你好，{name}')).toBe('你好，{name}')
    expect(interpolate('你好，{name}', { other: 'x' })).toBe('你好，{name}')
    expect(interpolate('纯文本')).toBe('纯文本')
  })
})

describe('createTranslator', () => {
  it('命中主目录并做插值', () => {
    const t = createTranslator({ locale: 'zh-CN', catalog })
    expect(t('app.title')).toBe('One Switch')
    expect(t('app.greeting', { name: '小明' })).toBe('你好，小明')
    expect(t.locale).toBe('zh-CN')
  })

  it('主目录缺 key 时用回退目录（按回退语言做复数选择）', () => {
    const fallback: Catalog = { 'app.fallbackGreeting': 'Hello, {name}', 'fallback.count': { one: '1 item', other: '{count} items' } }
    const t = createTranslator({ locale: 'zh-CN', catalog, fallbackCatalog: fallback, fallbackLocale: 'en' })

    expect(t('app.fallbackGreeting', { name: 'Ming' })).toBe('Hello, Ming')
    expect(t('fallback.count', { count: 2 })).toBe('2 items')
    expect(t.has('app.fallbackGreeting')).toBe(true)
  })

  it('完全找不到时返回 key 并触发 onMissing（不静默变空白）', () => {
    const onMissing = vi.fn()
    const t = createTranslator({ locale: 'zh-CN', catalog, onMissing })

    expect(t('app.missing')).toBe('app.missing')
    expect(onMissing).toHaveBeenCalledWith('app.missing')
    expect(t.has('app.missing')).toBe(false)
  })

  it('has 在主目录与回退目录里都算存在', () => {
    const t = createTranslator({ locale: 'zh-CN', catalog, fallbackCatalog: { 'only.fallback': 'F' } })
    expect(t.has('app.title')).toBe(true)
    expect(t.has('only.fallback')).toBe(true)
    expect(t.has('nope')).toBe(false)
  })

  it('按 count 选择复数分类，缺 count 时用 other', () => {
    const t = createTranslator({ locale: 'zh-CN', catalog })
    expect(t('item.count', { count: 1 })).toBe('1 项')
    expect(t('item.count', { count: 5 })).toBe('5 项')
    expect(t('item.count')).toBe('{count} 项')
  })

  it('复数对象没有 other 时退到第一个可用分类', () => {
    const t = createTranslator({ locale: 'zh-CN', catalog })
    expect(t('item.noOther')).toBe('只有单数')
  })

  it('同一语言的复数规则被缓存复用（连续调用结果稳定）', () => {
    const first = createTranslator({ locale: 'en', catalog: { c: { one: 'a', other: 'b' } } })
    const second = createTranslator({ locale: 'en', catalog: { c: { one: 'a', other: 'b' } } })
    expect(first('c', { count: 1 })).toBe('a')
    expect(second('c', { count: 3 })).toBe('b')
  })
})

describe('defaultOnMissing', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('开发期缺 key 时打一条警告，且只打一次', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fresh = await import('./index')
    const t = fresh.createTranslator({ locale: 'en', catalog: {} })

    t('first.missing')
    t('second.missing')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('[i18n] missing message')
  })

  it('生产环境不打印警告', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fresh = await import('./index')
    fresh.createTranslator({ locale: 'en', catalog: {} })('missing')

    expect(warn).not.toHaveBeenCalled()
  })
})
