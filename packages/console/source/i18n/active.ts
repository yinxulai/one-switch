/**
 * 界面语言的「当前生效取词函数」。
 *
 * React 树内用 `useTranslation()`；React 树之外（API 错误构造、格式化工具、非组件模块）
 * 拿不到 context，只能从这里取。渲染进程是单实例单语言，模块级缓存是安全的。
 *
 * 缓存的是**实例**而不只是 locale：`useTranslation()` 会把它塞进 context value，
 * 每次渲染换新实例会让所有订阅者重渲染。
 */

import { DEFAULT_LOCALE, type Locale, type TranslateParams } from '@common/i18n'
import { createAppTranslator, type UiCatalogKey } from '@common/i18n/catalogs'

export type AppTranslator = ReturnType<typeof createAppTranslator>

let cachedLocale: Locale = DEFAULT_LOCALE
let cachedTranslator: AppTranslator = createAppTranslator(DEFAULT_LOCALE)

/** 取某个语言的取词函数；同一语言复用同一实例。 */
export function getTranslator(locale: Locale): AppTranslator {
  if (locale !== cachedLocale) {
    cachedLocale = locale
    cachedTranslator = createAppTranslator(locale)
  }
  return cachedTranslator
}

/** 当前生效的取词函数。 */
export function activeTranslator(): AppTranslator {
  return cachedTranslator
}

/**
 * 按 key 取词，key 不在目录里时返回 `null`。
 *
 * 给「错误码 → 文案」这类**动态拼出来的 key** 用：静态 key 直接 `useTranslation()` 就好，
 * 编译期能校验，不需要这里的运行时兜底。
 */
export function tryTranslate(key: string, params?: TranslateParams): string | null {
  const catalogKey = key as UiCatalogKey
  return cachedTranslator.has(catalogKey) ? cachedTranslator(catalogKey, params) : null
}
