import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm-dialog'
import { AppLayout } from '@/components/layout'
import { ErrorBoundary, ErrorFallback } from '@/components/error-boundary'
import { AppSidebar, type PageKey, type Theme } from '@/components/app-sidebar'
import { useAppUiStore } from '@/store/app-ui-store'
import { useTranslation } from '@/i18n/provider'
import { useProxyStatus } from './features/proxy/hooks'

const pagePaths = {
  logicalModels: '/logical-models',
  providers: '/providers',
  access: '/access',
  rules: '/rules',
  router: '/router',
  overview: '/overview',
  requests: '/requests',
  settings: '/settings',
  logs: '/logs',
} as const satisfies Record<PageKey, string>

function App() {
  const pathname = useRouterState({ select: state => state.location.pathname })
  const activePage = (pathname.split('/').filter(Boolean)[0] || 'logicalModels') as PageKey
  const navigate = useNavigate()
  const themeMode = useAppUiStore(state => state.themeMode)
  const setThemeMode = useAppUiStore(state => state.setThemeMode)
  const [systemTheme, setSystemTheme] = useState<Theme>('light')
  const proxyStatus = useProxyStatus()
  const t = useTranslation()

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = () => setSystemTheme(media.matches ? 'dark' : 'light')
    updateSystemTheme()
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])

  const theme: Theme = themeMode === 'system' ? systemTheme : themeMode

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const toggleTheme = () => setThemeMode(theme === 'dark' ? 'light' : 'dark')

  return (
    <ToastProvider>
      <ConfirmProvider>
        <TooltipProvider>
          <AppLayout
            sidebar={(
              <AppSidebar
                activePage={activePage}
                theme={theme}
                proxyRunning={proxyStatus?.running ?? false}
                proxyPort={proxyStatus?.port}
                onNavigate={page => void navigate({ to: pagePaths[page] })}
                onToggleTheme={toggleTheme}
              />
            )}
          >
            {/*
             * 内层再兜一道：路由级错误会被这里拦截，侧栏与顶部导航继续可用，
             * 用户切到别的页面就自动恢复（`resetKeys` 是当前路径）。
             * `routing.tsx` 里的根路由 `errorComponent` 是外层保险，
             * 作用于 App 自身（包括侧栏、各种 Provider）抛错的情况。
             */}
            <ErrorBoundary
              resetKeys={[pathname]}
              fallback={fallbackProps => (
                <ErrorFallback
                  {...fallbackProps}
                  embedded
                  title={t('common.error.pageTitle')}
                  description={t('common.error.pageDescription')}
                />
              )}
            >
              <Outlet />
            </ErrorBoundary>
          </AppLayout>
        </TooltipProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

export default App
