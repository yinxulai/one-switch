import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { DOWNLOAD_VERSION, RELEASE_URL, REPO_URL } from './downloads'
import { FeatureIcon, type FeatureId } from './feature-icons'
import { PlatformIcon } from './platform-icons'
import { PLATFORMS } from './platforms'
import { LANGS, type Lang } from './i18n'

/**
 * 功能列表分两级：`primary` 是产品承诺（两张大卡，各占半行），
 * `secondary` 是支撑能力（四张小卡，各占四分之一行），用尺寸区分主次。
 * `key` 决定去英文表里找译文，`title` / `body` 是代码内联的中文兜底。
 */
interface Feature {
  id: FeatureId
  key: string
  tier: 'primary' | 'secondary'
  title: string
  body: string
}

const FEATURES: Feature[] = [
  {
    id: 'gateway',
    key: 'features.gateway',
    tier: 'primary',
    title: '一个本地网关',
    body: '把每个 AI 客户端都指向同一个本地地址，默认原样透传，自动识别协议、挑选渠道。',
  },
  {
    id: 'failover',
    key: 'features.failover',
    tier: 'primary',
    title: '故障转移，开箱即用',
    body: '限流、超时、额度耗尽、密钥被拒——都会自动把请求转到下一个渠道；已经开始输出的响应绝不拼接第二个渠道。',
  },
  {
    id: 'routing',
    key: 'features.routing',
    tier: 'secondary',
    title: '智能路由',
    body: '用节点图或规则表决定「哪些请求走哪组渠道」，每次保存都是一个可回滚的版本，还能拿真实请求试跑。',
  },
  {
    id: 'rewrite',
    key: 'features.rewrite',
    tier: 'secondary',
    title: '请求重写',
    body: '不写代码就能抹平供应商差异：增删改 Header、按 $.path 改 JSON 字段、按字面量或正则替换文本。',
  },
  {
    id: 'logs',
    key: 'features.logs',
    tier: 'secondary',
    title: '请求日志',
    body: '谁真正完成了这次请求、第几次尝试才成功、耗时与首字延迟、每秒 token、缓存命中——全部落库可查。',
  },
  {
    id: 'privacy',
    key: 'features.privacy',
    tier: 'secondary',
    title: '只在本地',
    body: '监听 127.0.0.1，密钥存在系统加密存储里。无账号、无云同步、无中转，只连你配置的上游。',
  },
]

const BORDER = 'border-[rgb(200_206_218/0.16)]'

export function App() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language as Lang

  // 让 `<html lang>` 跟随界面语言（无障碍与搜索引擎用）。
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#0b0d12] text-[#f3f4f8]">
      {/* 顶部光晕：用渐变而不是阴影做视觉焦点。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-130 bg-[radial-gradient(58%_100%_at_50%_0%,rgb(126_166_255/0.14),transparent_72%)]"
      />

      {/* 顶栏：滚动时常驻，仅靠毛玻璃与一条发丝线分隔。 */}
      <header className="sticky top-0 z-20 border-b border-[rgb(200_206_218/0.08)] bg-[#0b0d12]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="OSW" className="h-8 w-8" />
            <span className="text-base font-semibold tracking-tight">OSW</span>
          </div>
          <nav className={`flex items-center gap-1 rounded-lg border ${BORDER} p-0.5`}>
            {LANGS.map((l) => (
              <button
                key={l.id}
                onClick={() => void i18n.changeLanguage(l.id)}
                className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                  l.id === lang
                    ? 'bg-[#f3f4f8] text-[#0b0d12]'
                    : 'text-[rgb(200_206_218/0.7)] hover:text-[#f3f4f8]'
                }`}
              >
                {l.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        {/* Hero：全站第一层级，只有它允许居中的大排版。 */}
        <section className="flex flex-col items-center pt-20 pb-24 text-center sm:pt-28">
          <div className={`rounded-2xl border ${BORDER} bg-[rgb(255_255_255/0.03)] p-4`}>
            <img src="/icon.svg" alt="" aria-hidden="true" className="h-14 w-14 sm:h-16 sm:w-16" />
          </div>

          <h1 className="mt-8 max-w-4xl text-balance text-4xl font-semibold leading-[1.2] tracking-tight sm:text-5xl lg:text-6xl">
            {t('hero.slogan', '本地的 AI 路由 + 故障转移')}
          </h1>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a
              href={RELEASE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg bg-[#f3f4f8] px-6 py-2.5 text-sm font-semibold text-[#0b0d12] transition-colors hover:bg-white"
            >
              {t('hero.download', '下载最新版本')}
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center justify-center rounded-lg border ${BORDER} px-6 py-2.5 text-sm font-medium text-[rgb(200_206_218/0.85)] transition-colors hover:border-[rgb(200_206_218/0.3)] hover:text-[#f3f4f8]`}
            >
              {t('hero.source', '查看源码')}
            </a>
          </div>
        </section>

        {/* 功能：两张大卡（产品承诺）+ 四张小卡（支撑能力），靠尺寸而非颜色区分主次。 */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-12">
          {FEATURES.map((f) => {
            const primary = f.tier === 'primary'
            return (
              <article
                key={f.key}
                className={`group flex flex-col rounded-xl border ${BORDER} transition-colors duration-200 hover:border-[rgb(200_206_218/0.3)] ${
                  primary
                    ? 'bg-[rgb(255_255_255/0.03)] p-7 sm:col-span-6'
                    : 'bg-[rgb(255_255_255/0.015)] p-5 sm:col-span-6 lg:col-span-3'
                }`}
              >
                <span
                  className={
                    primary
                      ? 'flex h-10 w-10 items-center justify-center rounded-lg border border-[rgb(126_166_255/0.28)] bg-[rgb(126_166_255/0.1)] text-[#7ea6ff]'
                      : 'flex h-8 w-8 items-center justify-center text-[rgb(200_206_218/0.6)]'
                  }
                >
                  <FeatureIcon id={f.id} className={primary ? 'h-5 w-5' : 'h-4.5 w-4.5'} />
                </span>

                <h2
                  className={
                    primary
                      ? 'mt-5 text-lg font-semibold tracking-tight'
                      : 'mt-4 text-sm font-semibold tracking-tight'
                  }
                >
                  {t(`${f.key}.title`, f.title)}
                </h2>
                <p
                  className={
                    primary
                      ? 'mt-2.5 text-sm leading-relaxed text-[rgb(200_206_218/0.7)]'
                      : 'mt-2 text-[13px] leading-relaxed text-[rgb(200_206_218/0.65)]'
                  }
                >
                  {t(`${f.key}.body`, f.body)}
                </p>
              </article>
            )
          })}
        </section>

        {/* 下载：整页唯一的主行动区，居中收口成一个面板。 */}
        <section className="mt-20 pb-4">
          <div
            className={`mx-auto max-w-3xl rounded-2xl border ${BORDER} bg-[rgb(255_255_255/0.02)] px-6 py-12 text-center`}
          >
            <h2 className="text-2xl font-semibold tracking-tight">
              {t('downloads.title', '下载')}
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-pretty text-sm text-[rgb(200_206_218/0.7)]">
              {t('downloads.subtitle', '支持 macOS、Windows 与 Linux，从最新发布页按平台自取。')}
            </p>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
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
              className="mx-auto mt-8 flex w-full max-w-sm items-center justify-center rounded-lg bg-[#f3f4f8] px-6 py-3 text-sm font-semibold text-[#0b0d12] transition-colors hover:bg-white"
            >
              {t('downloads.action', '下载最新版本')}
            </a>

            <p className="mt-3 text-center text-xs text-[rgb(200_206_218/0.55)]">
              {t('downloads.version', '当前版本 · v{{version}}', { version: DOWNLOAD_VERSION })}
              {' · '}
              {t('downloads.host', '在 GitHub Releases 上打开')}
            </p>
          </div>

          <p className="mx-auto mt-5 max-w-xl text-center text-xs text-[rgb(200_206_218/0.55)]">
            {t(
              'downloads.detail',
              'macOS 构建为 ad-hoc 签名且未公证——若首次启动被阻止，请在 系统设置 → 隐私与安全性 中允许。',
            )}
          </p>
        </section>
      </main>

      {/* 页脚：最弱层级，只留一条发丝线。 */}
      <footer className="mt-16 border-t border-[rgb(200_206_218/0.12)]">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-center text-xs text-[rgb(200_206_218/0.5)]">
            {t('footer', '源码可见 · PolyForm Noncommercial · macOS · Windows · Linux')}
          </p>
        </div>
      </footer>
    </div>
  )
}
