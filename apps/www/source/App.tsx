import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DOWNLOAD_VERSION, RELEASE_URL } from './downloads'
import { PlatformIcon } from './platform-icons'
import { PLATFORMS } from './platforms'
import { LANGS, type Lang } from './i18n'

/**
 * 功能列表：`key` 决定去英文表里找译文，`title` / `body` 是代码内联的中文兜底，
 * 英文缺 key 时原样展示。
 */
const FEATURES: { key: string; title: string; body: string }[] = [
  {
    key: 'features.gateway',
    title: '一个本地网关',
    body: '把每个 AI 客户端都指向同一个本地地址。OSW 自动识别协议、挑选渠道，失败时自动切换。',
  },
  {
    key: 'features.failover',
    title: '故障转移，开箱即用',
    body: '限流、超时、额度耗尽、密钥被拒——都会自动把请求转到下一个渠道。',
  },
  {
    key: 'features.privacy',
    title: '数据只留在你的机器上',
    body: '监听 127.0.0.1，密钥存在系统加密存储里。无账号、无云同步、无中转服务器。',
  },
]

export function App() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language as Lang

  // 让 `<html lang>` 跟随界面语言（无障碍与搜索引擎用）。
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  return (
    <div className="min-h-screen bg-[#0b0d12] text-[#f3f4f8]">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
        {/* 顶栏 */}
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="OSW" className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight">OSW</span>
          </div>
          <nav className="flex items-center gap-1 rounded-md border border-[rgb(200_206_218/0.16)] p-0.5">
            {LANGS.map((l) => (
              <button
                key={l.id}
                onClick={() => void i18n.changeLanguage(l.id)}
                className={`rounded px-2.5 py-1 text-sm ${
                  l.id === lang
                    ? 'bg-[#f3f4f8] text-[#0b0d12]'
                    : 'text-[rgb(200_206_218/0.7)] hover:text-[#f3f4f8]'
                }`}
              >
                {l.label}
              </button>
            ))}
          </nav>
        </header>

        {/* Hero */}
        <main className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <img src="/icon.svg" alt="OSW" className="mb-8 h-24 w-24" />
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">OSW</h1>
          <p className="mt-4 max-w-2xl text-lg text-[rgb(200_206_218/0.75)]">
            {t('hero.tagline1', '把每一个 LLM 渠道收进同一个本地地址。')}
            <br className="hidden sm:block" />
            {t('hero.tagline2', '一个倒下，下一个自动顶上。')}
          </p>

          {/* 功能 */}
          <section className="mt-16 grid w-full gap-4 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.key}
                className="rounded-md border border-[rgb(200_206_218/0.16)] p-6 text-left"
              >
                <h2 className="text-base font-semibold">{t(`${f.key}.title`, f.title)}</h2>
                <p className="mt-2 text-sm text-[rgb(200_206_218/0.7)]">
                  {t(`${f.key}.body`, f.body)}
                </p>
              </div>
            ))}
          </section>

          {/* 下载：一个公共按钮 → 最新 release 页；上方一行平台标记只做「支持哪些平台」的说明。 */}
          <section className="mt-16 w-full">
            <h2 className="text-2xl font-semibold">{t('downloads.title', '下载')}</h2>
            <p className="mt-2 text-sm text-[rgb(200_206_218/0.7)]">
              {t('downloads.subtitle', '支持 macOS、Windows 与 Linux，从最新发布页按平台自取。')}
            </p>

            <div className="mt-6 rounded-md border border-[rgb(200_206_218/0.16)] p-6">
              <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
                {PLATFORMS.map((platform) => (
                  <div
                    key={platform.id}
                    className="flex items-center gap-2 text-[rgb(200_206_218/0.85)]"
                  >
                    <PlatformIcon id={platform.id} className="h-5 w-5 shrink-0" />
                    <span className="text-sm">{platform.label}</span>
                  </div>
                ))}
              </div>

              <a
                href={RELEASE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 flex w-full items-center justify-center rounded-md bg-[#f3f4f8] px-6 py-3 text-sm font-semibold text-[#0b0d12] transition-colors hover:bg-white"
              >
                {t('downloads.action', '下载最新版本')}
              </a>

              <p className="mt-3 text-center text-xs text-[rgb(200_206_218/0.55)]">
                {t('downloads.version', '当前版本 · v{{version}}', { version: DOWNLOAD_VERSION })}
                {' · '}
                {t('downloads.host', '在 GitHub Releases 上打开')}
              </p>
            </div>

            <p className="mx-auto mt-6 max-w-xl text-xs text-[rgb(200_206_218/0.55)]">
              {t(
                'downloads.detail',
                'macOS 构建为 ad-hoc 签名且未公证——若首次启动被阻止，请在 系统设置 → 隐私与安全性 中允许。',
              )}
            </p>
          </section>
        </main>

        {/* 页脚 */}
        <footer className="border-t border-[rgb(200_206_218/0.16)] py-6">
          <p className="text-center text-xs text-[rgb(200_206_218/0.55)]">
            {t('footer', '源码可见 · PolyForm Noncommercial · macOS · Windows · Linux')}
          </p>
        </footer>
      </div>
    </div>
  )
}
