import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { TablePager } from '@/components/table-primitives'
import { useTranslation } from '@/i18n/provider'
import { LogsTable } from './components/logs-table'
import { LogsToolbar } from './components/logs-toolbar'
import { useLogsModel } from './hooks/use-logs-model'

interface LogsPageProps {
  q?: string
}

export function LogsPage(props: LogsPageProps) {
  const model = useLogsModel(props.q)
  const t = useTranslation()
  const totalPages = model.totalPages
  const showPager = !model.loading && model.total > model.pageSize

  return (
    <PageLayout>
      <PageHeader
        title={t('logs.title')}
        description={t('logs.description')}
      />
      <PageContent>
        <LogsToolbar total={model.total} live={model.live} refreshing={model.refreshing} levelFilter={model.levelFilter} searchText={model.searchText} clearDialogOpen={model.clearDialogOpen} onLiveChange={() => model.setLive(value => !value)} onRefresh={() => void model.refresh()} onExport={() => void model.exportLogs()} onClear={() => void model.clearLogs()} onDialogChange={model.setClearDialogOpen} onLevelChange={model.setLevelFilter} onSearchChange={model.setSearchText} />
        <LogsTable logs={model.logs} loading={model.loading} error={model.error} filtered={model.filtered} onRetry={() => void model.refresh()} />
        {showPager && <TablePager page={model.page} totalPages={totalPages} onPageChange={model.goToPage} />}
      </PageContent>
    </PageLayout>
  )
}
