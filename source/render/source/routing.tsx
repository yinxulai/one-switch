import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
  useNavigate,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import type { AnalyticsRange } from '@common/schemas'
import App from './App'
import { ErrorFallback } from './components/error-boundary'
import { useTranslation } from './i18n/provider'
import { LogicalModelsPage } from './pages/logical-models/page'
import { ModelManagementPage } from './pages/model-management/page'
import { OverviewPage } from './pages/overview/page'
import { RuntimeSettingsPage } from './pages/runtime-settings/page'
import { LogsPage } from './pages/logs/page'
import { RequestLogsPage } from './pages/request-logs/page'
import { RequestRewriteRulesPage } from './pages/request-rewrite-rules/page'
import { AccessConfigPage } from './pages/access-config/page'
import { RouterPage } from './pages/router/page'

/**
 * 根路由的报错兜底。
 *
 * 不配这个的话，TanStack Router 会在控制台警告「consider setting an 'errorComponent' in your RootRoute」，
 * 并且只给一块没有样式、没有重试按钮、且提示语不区分场景的默认界面；
 * 配了之后，任何一个路由组件在渲染期抛错都由它接管，用户能原地重试。
 */
function RootErrorComponent(props: ErrorComponentProps) {
  const t = useTranslation()
  return <ErrorFallback error={props.error} reset={props.reset} title={t('common.error.rootTitle')} description={t('common.error.rootDescription')} />
}

const rootRoute = createRootRoute({ component: App, errorComponent: RootErrorComponent })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => { throw redirect({ to: '/router', replace: true }) },
})

const logicalModelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logical-models',
  component: LogicalModelsRoute,
})

function LogicalModelsRoute() {
  const navigate = useNavigate()
  return (
    <LogicalModelsPage
      onNavigateToModels={() => void navigate({ to: '/providers' })}
      onNavigateToAccess={() => void navigate({ to: '/access' })}
      onNavigateToProviderAnalytics={providerId => void navigate({ to: '/overview/$providerId', params: { providerId }, search: { range: '7d' } })}
    />
  )
}

const providersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/providers',
  component: ProvidersRoute,
})

function ProvidersRoute() {
  const navigate = useNavigate()
  return <ModelManagementPage onNavigateToProviderAnalytics={providerId => void navigate({ to: '/overview/$providerId', params: { providerId }, search: { range: '7d' } })} />
}

interface OverviewSearch {
  range: AnalyticsRange
}

export const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/overview',
  validateSearch: (search: Record<string, unknown>): OverviewSearch => ({
    range: search.range === 'today' || search.range === '30d' ? search.range : '7d',
  }),
  component: Outlet,
})

const overviewIndexRoute = createRoute({
  getParentRoute: () => overviewRoute,
  path: '/',
  component: OverviewIndexRoute,
})

function OverviewIndexRoute() {
  const { range } = overviewRoute.useSearch()
  const navigate = useNavigate({ from: overviewIndexRoute.fullPath })
  return (
    <OverviewPage
      range={range}
      onRangeChange={nextRange => void navigate({ search: { range: nextRange } })}
      onSelectProvider={providerId => {
        if (providerId) void navigate({ to: '/overview/$providerId', params: { providerId }, search: { range } })
      }}
    />
  )
}

const overviewProviderRoute = createRoute({
  getParentRoute: () => overviewRoute,
  path: '$providerId',
  component: OverviewProviderRoute,
})

function OverviewProviderRoute() {
  const { range } = overviewRoute.useSearch()
  const { providerId } = overviewProviderRoute.useParams()
  const navigate = useNavigate({ from: overviewProviderRoute.fullPath })
  return (
    <OverviewPage
      range={range}
      providerId={providerId}
      onRangeChange={nextRange => void navigate({ search: { range: nextRange } })}
      onSelectProvider={nextProviderId => {
        if (nextProviderId) {
          void navigate({ to: '/overview/$providerId', params: { providerId: nextProviderId }, search: { range } })
        } else {
          void navigate({ to: '/overview', search: { range } })
        }
      }}
    />
  )
}

const accessRoute = createRoute({ getParentRoute: () => rootRoute, path: '/access', component: AccessConfigRoute })

function AccessConfigRoute() {
  const navigate = useNavigate()
  return (
    <AccessConfigPage
      onNavigateToModels={() => void navigate({ to: '/providers' })}
      onNavigateToSettings={() => void navigate({ to: '/settings' })}
    />
  )
}

const rulesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/rules', component: RequestRewriteRulesPage })
const routerRoute = createRoute({ getParentRoute: () => rootRoute, path: '/router', component: RouterPage })
const requestsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/requests', component: RequestLogsPage })

interface LogsSearch {
  q?: string
}

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  validateSearch: (search: Record<string, unknown>): LogsSearch => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q.trim() : undefined,
  }),
  component: LogsRoute,
})

function LogsRoute() {
  const { q } = logsRoute.useSearch()
  return <LogsPage q={q} />
}
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsRoute })

function SettingsRoute() {
  return <RuntimeSettingsPage />
}

const overviewRouteTree = overviewRoute.addChildren([overviewIndexRoute, overviewProviderRoute])

const routeTree = rootRoute.addChildren([
  indexRoute,
  logicalModelsRoute,
  providersRoute,
  accessRoute,
  rulesRoute,
  routerRoute,
  overviewRouteTree,
  requestsRoute,
  logsRoute,
  settingsRoute,
])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
  defaultNotFoundComponent: () => <Navigate to="/router" replace />,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
