/**
 * i18n 核心：locale 解析、插值、取词。
 *
 * 刻意不引入 i18next 这类运行时：本应用没有异步加载语言包的需求，也不需要 ICU 消息格式，
 * `Intl.PluralRules` 已经覆盖复数，其余都能用纯函数表达。对外只暴露 `createTranslator`
 * 与 `resolveLocale` 两个概念，将来真要换实现，替换的也只是这一个文件。
 *
 * 目录本身不在这里——见 `./catalogs/`。
 */

import { DEFAULT_LOCALE, LOCALES, type Catalog, type Locale, type MessageValue, type TranslateParams } from './types'

export * from './types'

const PLURAL_RULES = new Map<Locale, Intl.PluralRules>()

/** `Intl.PluralRules` 构造有成本，按语言缓存；语言数量少，不需要淘汰。 */
function pluralRules(locale: Locale): Intl.PluralRules {
  let rules = PLURAL_RULES.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    PLURAL_RULES.set(locale, rules)
  }
  return rules
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * 把任意 BCP-47 标签收敛到支持的语言，无法识别时返回 `null`。
 *
 * 只比对主语言子标签：`zh-Hans-CN`、`zh-TW`、`zh` 都落到 `zh-CN`。
 * 不认识的语种返回 `null` 而不是默认值——调用方要能区分「识别不出」与「识别为 en」。
 */
export function normalizeLocale(raw?: string | null): Locale | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.startsWith('zh')) return 'zh-CN'
  if (lower.startsWith('en')) return 'en'
  return null
}

/**
 * 解析最终生效的语言。
 *
 * `preference` 为 `'system'` 或无法识别时用 `systemLocale`；两者都识别不出才回退 `DEFAULT_LOCALE`。
 * 主进程传 `app.getLocale()`，渲染进程传 `navigator.language`。
 */
export function resolveLocale(preference: string | null | undefined, systemLocale?: string | null): Locale {
  return normalizeLocale(preference) ?? normalizeLocale(systemLocale) ?? DEFAULT_LOCALE
}

/** `{name}` 占位替换；未提供对应参数时保留原样，便于一眼看出漏传。 */
export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key]
    return value === undefined ? match : String(value)
  })
}

/**
 * 取词函数。
 *
 * `K` 是允许的 key 集合：业务代码用带目录的 `Translator<UiCatalogKey>`，拼错 key 直接编译不过；
 * 核心层默认 `string`，因为它不该知道任何目录长什么样。
 */
export interface Translator<K extends string = string> {
  (key: K, params?: TranslateParams): string
  /** 当前生效语言。 */
  readonly locale: Locale
  /** key 在当前目录或回退目录里是否存在。 */
  has(key: K): boolean
}

export interface CreateTranslatorOptions {
  locale: Locale
  /** 主语言目录。 */
  catalog: Catalog
  /** 缺 key 时的回退目录，通常是英文。 */
  fallbackCatalog?: Catalog
  fallbackLocale?: Locale
  /** 缺 key 时的回调；默认只在开发期打一条警告。 */
  onMissing?: (key: string) => void
}

let warnedMissing = false

function defaultOnMissing(locale: Locale, key: string): void {
  // 只在开发期提示，且同一个 key 只说一次，避免刷屏。
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return
  if (warnedMissing) return
  warnedMissing = true
  console.warn(`[i18n] missing message locale=${locale} key=${key}`)
}

function selectMessage(value: MessageValue, locale: Locale, params?: TranslateParams): string {
  if (typeof value === 'string') return value
  const count = params?.count
  const category = typeof count === 'number' ? pluralRules(locale).select(count) : 'other'
  return value[category] ?? value.other ?? Object.values(value)[0] ?? ''
}

/**
 * 构造一个取词函数。
 *
 * 查找顺序：当前语言 → 回退语言 → 原样返回 key（并触发 `onMissing`）。
 * 返回 key 而不是空串，是为了让漏翻在界面上「看得见」而不是静默变成空白。
 */
export function createTranslator<K extends string = string>(options: CreateTranslatorOptions): Translator<K> {
  const { locale, catalog, fallbackCatalog, fallbackLocale = DEFAULT_LOCALE, onMissing } = options

  const warn = onMissing ?? ((key: string) => defaultOnMissing(locale, key))

  const translate = (key: string, params?: TranslateParams): string => {
    const primary = catalog[key]
    if (primary !== undefined) return interpolate(selectMessage(primary, locale, params), params)

    const fallback = fallbackCatalog?.[key]
    if (fallback !== undefined) return interpolate(selectMessage(fallback, fallbackLocale, params), params)

    warn(key)
    return key
  }

  return Object.assign(translate, {
    locale,
    has: (key: string) => catalog[key] !== undefined || fallbackCatalog?.[key] !== undefined,
  })
}

/** 目录差异检查：返回 `target` 相对 `source` 缺失与多余的 key。 */
export function diffCatalogKeys(source: Catalog, target: Catalog): { missing: string[]; extra: string[] } {
  const sourceKeys = new Set(Object.keys(source))
  const targetKeys = new Set(Object.keys(target))
  return {
    missing: [...sourceKeys].filter(key => !targetKeys.has(key)),
    extra: [...targetKeys].filter(key => !sourceKeys.has(key)),
  }
}
