import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { TablePager } from '@/components/table-primitives'
import { RequestLogsFilters } from './components/request-logs-filters'
import { RequestLogsTable } from './components/request-logs-table'
import { PAGE_SIZE } from './queries'
import { useRequestLogsService } from './service'

export function RequestLogsPage() {
  const { logs, total, providers, providerModelOptions, loading, refreshing, error, filtered, details, detailLoadingIds, detailErrors, getModelName, loadDetail, refresh, setFilter, filter, expandedId, goToPage, page } = useRequestLogsService()

  const providerOptions = useMemo(() => {
    return providers
      .map(p => ({ id: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [providers])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handlePageChange = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages)
    goToPage(clamped)
  }

  const toggleExpand = (id: string) => {
    loadDetail(expandedId === id ? null : id)
  }

  return (
    <PageLayout>
      <PageHeader
        title="请求记录"
        description="最近的代理请求，以及每次请求实际使用的供应商模型与失败切换情况"
        actions={
          <Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
            刷新
          </Button>
        }
      />
      <PageContent>
        <RequestLogsFilters
          filter={filter}
          providerOptions={providerOptions}
          providerModelOptions={providerModelOptions}
          total={total}
          applyFilter={setFilter}
        />
        <RequestLogsTable
          logs={logs}
          loading={loading}
          error={error}
          filtered={filtered}
          expandedId={expandedId}
          details={details}
          detailLoadingIds={detailLoadingIds}
          detailErrors={detailErrors}
          getModelName={getModelName}
          toggleExpand={toggleExpand}
          onRetry={() => void refresh()}
        />
        {!loading && totalPages > 1 && <TablePager page={page} totalPages={totalPages} onPageChange={handlePageChange} />}
      </PageContent>
    </PageLayout>
  )
}
