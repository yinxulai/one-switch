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
    slogan: 'Local AI routing and failover',
    download: 'Download the latest release',
    source: 'View source',
  },
  features: {
    gateway: {
      title: 'One local gateway',
      body: 'Point every AI client at a single local address. Requests pass through untouched, and OSW identifies the protocol and picks a channel for you.',
    },
    failover: {
      title: 'Failover that just works',
      body: 'Rate limits, timeouts, exhausted quota and rejected keys all push the request to the next channel automatically — a response that already started streaming is never spliced from another channel.',
    },
    routing: {
      title: 'Smart Routing',
      body: 'Choose which requests land in which channel group by drawing a node graph or writing a rule table. Every save is a version you can roll back, and a test run shows the branch a real request takes.',
    },
    rewrite: {
      title: 'Request Rewrite',
      body: 'Smooth over provider differences without code: add, drop or change headers, edit JSON fields by $.path, replace text by literal or regex.',
    },
    logs: {
      title: 'Request Logs',
      body: 'Which provider and model really served the request, which attempt succeeded, how long it took, first-token latency, tokens per second and cache hits — all stored and queryable.',
    },
    privacy: {
      title: 'Local only',
      body: 'Listener on 127.0.0.1, keys in the OS-encrypted store. No account, no cloud sync, no relay — requests only reach the upstreams you configured.',
    },
  },
  downloads: {
    title: 'Download',
    subtitle: 'Available for macOS, Windows and Linux — pick your installer on the latest release.',
    action: 'Download the latest release',
    host: 'Opens GitHub Releases',
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
