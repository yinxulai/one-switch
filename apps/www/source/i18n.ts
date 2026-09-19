import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

/** 站点支持的语言。 */
export type Lang = 'en' | 'zh'

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
]

/**
 * 兜底语言固定为中文：**中文不建资源表**，而是直接写在 `t(key, '中文文案')` 的
 * 兜底参数里（见 `App.tsx`）。所以英文缺 key 时会自动回落到代码内联的中文，
 * 不会出现「页面漏一句翻译」的情况。
 */
export const FALLBACK_LANG: Lang = 'zh'

/**
 * 英文译文表，key 与 `App.tsx` 里 `t()` 的第一个参数一一对应。
 * 新增文案时：先在 `App.tsx` 写中文兜底，再决定要不要在这里补英文。
 */
const en = {
  hero: {
    tagline1: 'Put every LLM channel you own behind one local address.',
    tagline2: 'When one goes down, the next one takes over.',
  },
  features: {
    gateway: {
      title: 'One local gateway',
      body: 'Point every AI client at a single local address. OSW identifies the protocol, picks a channel and moves on when it fails.',
    },
    failover: {
      title: 'Failover that just works',
      body: 'Rate limits, timeouts, exhausted quota and rejected keys all push the request to the next channel automatically.',
    },
    privacy: {
      title: 'Your data stays on your machine',
      body: 'Local listener on 127.0.0.1, keys in the OS-encrypted store. No account, no cloud sync, no relay.',
    },
  },
  downloads: {
    title: 'Download',
    subtitle: 'Choose your platform and download the latest installer.',
    action: 'Download',
    version: 'Current release · v{{version}}',
    detail:
      'macOS builds are ad-hoc signed and not notarized — if the first launch is blocked, allow it under System Settings → Privacy & Security.',
  },
  footer: 'Source-available under PolyForm Noncommercial · macOS · Windows · Linux',
}

/** 首次进入按浏览器语言选一个；识别不到就用兜底语言（中文）。 */
function detectLang(): Lang {
  const preferred = typeof navigator === 'undefined' ? '' : navigator.language
  return preferred.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: detectLang(),
  fallbackLng: FALLBACK_LANG,
  // 纯前端渲染且文案自带中文兜底，插值无需转义。
  interpolation: { escapeValue: false },
  // 资源内联、初始化同步完成，无需 Suspense 边界。
  react: { useSuspense: false },
})

export default i18n
