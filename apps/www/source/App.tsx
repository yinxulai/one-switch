import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DOWNLOAD_VERSION, downloads } from './downloads'
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
  const items = downloads()

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

          {/* 下载 */}
          <section className="mt-16 w-full">
            <h2 className="text-2xl font-semibold">{t('downloads.title', '下载')}</h2>
            <p className="mt-2 text-sm text-[rgb(200_206_218/0.7)]">
              {t('downloads.subtitle', '选择你的平台，下载最新安装包。')}
            </p>
            <div className="mt-6 grid w-full gap-4 sm:grid-cols-3">
              {items.map((item) => (
                <a
                  key={item.id}
                  href={`/~asset/${item.id}`}
                  className="group rounded-md border border-[rgb(200_206_218/0.16)] p-6 text-left transition-colors hover:border-[rgb(255_255_255/0.35)]"
                >
                  <div className="text-base font-semibold">
                    {PLATFORMS.find((p) => p.id === item.id)?.label}
                  </div>
                  <div className="mt-1 text-xs text-[rgb(200_206_218/0.55)]">
                    {t('downloads.version', '当前版本 · v{{version}}', { version: DOWNLOAD_VERSION })}
                  </div>
                  <div className="mt-4 text-sm font-semibold text-[#7ea6ff] group-hover:underline">
                    {t('downloads.action', '下载')} →
                  </div>
                </a>
              ))}
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
