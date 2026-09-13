import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { AnalyticsRange } from '@common/schemas'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'
import { useOverviewService, useProviderAnalyticsDetail } from './service'
import { StatsGrid } from './components/stats-grid'
import { TrendChart } from './components/trend-chart'
import { ProviderDistribution } from './components/provider-distribution'
import { ProviderDetail } from './components/provider-detail'
import { ModelRanking } from './components/model-ranking'
import { LatencyDistribution } from './components/latency-distribution'
import { FailureReasons } from './components/failure-reasons'

interface OverviewPageProps {
  range: AnalyticsRange
  providerId?: string
  onRangeChange: (range: AnalyticsRange) => void
  onSelectProvider: (providerId?: string) => void
}

export function OverviewPage(props: OverviewPageProps) {
  const { data, loading, refreshing, error, refresh } = useOverviewService(props.range)
  const providerDetail = useProviderAnalyticsDetail(props.providerId ?? null, props.range)
  const t = useTranslation()
  const selectedProviderName = providerDetail.data?.summary.providerName
    ?? data?.providerStats.find(provider => provider.providerId === props.providerId)?.providerName

  const renderLoading = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-inset p-3">
            <Skeleton className="mb-2 h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-44 w-full" />
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-32 w-full" />
        </Card>
        <Card className="p-4">
          <Skeleton className="mb-4 h-4 w-24" />
          <Skeleton className="h-32 w-full" />
        </Card>
      </div>
    </div>
  )

  const renderProviderDetail = () => {
    if (providerDetail.loading) {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20" />)}</div>
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-60 w-full" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      )
    }
    if (providerDetail.error) {
      return (
        <Card>
          <EmptyState
            embedded
            icon={AlertTriangle}
            title={t('overview.providerError.title')}
            description={t('overview.providerError.description')}
            action={<Button variant="outline" size="sm" onClick={() => void providerDetail.refresh()}>{t('common.action.refresh')}</Button>}
          />
        </Card>
      )
    }
    if (!providerDetail.data) return null
    return <ProviderDetail detail={providerDetail.data} range={props.range} />
  }

  const renderContent = () => {
    if (props.providerId) return renderProviderDetail()
    if (error) {
      return (
        <Card>
          <EmptyState
            embedded
            icon={AlertTriangle}
            title={t('overview.error.title')}
            description={t('overview.error.description')}
            action={<Button variant="outline" size="sm" onClick={() => void refresh()}>{t('common.action.refresh')}</Button>}
          />
        </Card>
      )
    }
    if (!data) return null
    return (
      <>
        <StatsGrid summary={data.summary} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
          <ProviderDistribution stats={data.providerStats} onSelectProvider={provider => props.onSelectProvider(provider.providerId)} />
          <TrendChart trend={data.trend} range={props.range} stretchToRow />
        </div>
        <ModelRanking stats={data.modelStats} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LatencyDistribution buckets={data.latencyDistribution} />
          <FailureReasons reasons={data.failureReasons} failedCount={data.summary.failedCount} totalRequests={data.summary.totalRequests} />
        </div>
      </>
    )
  }

  const renderBody = () => {
    if (!props.providerId && loading) return renderLoading()
    return renderContent()
  }

  const activeRefreshing = props.providerId ? providerDetail.refreshing : refreshing
  const refreshActiveView = () => props.providerId ? providerDetail.refresh() : refresh()

  return (
    <PageLayout>
      <PageHeader
        title={props.providerId ? t('overview.provider.title', { provider: selectedProviderName ?? t('overview.provider.unknown') }) : t('overview.title')}
        description={props.providerId ? t('overview.provider.description') : t('overview.description')}
        breadcrumbs={props.providerId ? [{ label: t('overview.provider.breadcrumb'), onClick: () => props.onSelectProvider() }, { label: selectedProviderName ?? t('overview.provider.unknown') }] : undefined}
        actions={(
          <div className="flex items-center gap-2">
            <Tabs value={props.range} onValueChange={value => props.onRangeChange(value as AnalyticsRange)}>
              <TabsList>
                <TabsTrigger value="today" className="px-2.5 text-xs">{t('overview.range.today')}</TabsTrigger>
                <TabsTrigger value="7d" className="px-2.5 text-xs">{t('overview.range.7d')}</TabsTrigger>
                <TabsTrigger value="30d" className="px-2.5 text-xs">{t('overview.range.30d')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="icon" title={t('overview.refresh')} aria-label={t('overview.refresh')} disabled={activeRefreshing} onClick={() => void refreshActiveView()}>
              <RefreshCw size={14} className={cn(activeRefreshing && 'animate-spin')} />
            </Button>
          </div>
        )}
      />
      <PageContent>
        {renderBody()}
      </PageContent>
    </PageLayout>
  )
}
