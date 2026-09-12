import type { ReactNode } from 'react'
import { Check, LoaderCircle, RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { useRuntimeSettingsService } from './service'
import { ListenConfigCard } from './components/listen-config-card'
import { OutboundProxyCard } from './components/outbound-proxy-card'
import { FailoverCard } from './components/failover-card'
import { LogRetentionCard } from './components/log-retention-card'
import { GeneralCard } from './components/general-card'
import { DevelopmentCard } from './components/development-card'
import { UpdateCard } from './components/update-card'
import { useAppUiStore } from '@/store/app-ui-store'

interface SettingsSectionProps {
  title: string
  children: ReactNode
}

function SettingsSection(props: SettingsSectionProps) {
  return (
    <section className="space-y-2.5">
      <h2 className="px-1 system-xs-medium text-text-tertiary">{props.title}</h2>
      <div className="space-y-3">{props.children}</div>
    </section>
  )
}

export function RuntimeSettingsPage() {
  const service = useRuntimeSettingsService()
  const themeMode = useAppUiStore(state => state.themeMode)
  const setThemeMode = useAppUiStore(state => state.setThemeMode)

  return (
    <PageLayout className="flex min-h-full flex-col">
      <PageHeader title="设置" description="管理应用行为、网络连接、故障恢复与本地数据" />
      <PageContent>
        {service.loading || !service.settings ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="min-h-36 p-4">
                <Skeleton className="mb-3 h-4 w-32" />
                <Skeleton className="mb-5 h-3 w-52" />
                <Skeleton className="h-9 w-full" />
              </Card>
            ))}
          </div>
        ) : (
          <>
            <SettingsSection title="应用">
              <GeneralCard
                autoLaunch={service.settings.autoLaunch}
                onAutoLaunchChange={value => service.updateField('autoLaunch', value)}
                themeMode={themeMode}
                onThemeModeChange={setThemeMode}
              />
              <UpdateCard />
            </SettingsSection>

            <SettingsSection title="网络">
              <ListenConfigCard
                listenHost={service.settings.listenHost}
                listenPort={service.settings.listenPort}
                proxyRunning={service.proxyStatus?.running ?? false}
                onHostChange={value => service.updateField('listenHost', value)}
                onPortChange={value => service.updateField('listenPort', value)}
              />
              <OutboundProxyCard
                mode={service.settings.outboundProxyMode}
                proxyUrl={service.settings.outboundProxyUrl}
                bypass={service.settings.outboundProxyBypass}
                onModeChange={value => service.updateField('outboundProxyMode', value)}
                onProxyUrlChange={value => service.updateField('outboundProxyUrl', value)}
                onBypassChange={value => service.updateField('outboundProxyBypass', value)}
              />
            </SettingsSection>

            <SettingsSection title="可靠性">
              <FailoverCard settings={service.settings} onUpdate={service.updateField} />
            </SettingsSection>

            <SettingsSection title="数据">
              <LogRetentionCard
                retentionDays={service.settings.logRetentionDays}
                captureRequestContent={service.settings.captureRequestContent}
                onRetentionDaysChange={value => service.updateField('logRetentionDays', value)}
                onCaptureRequestContentChange={value => service.updateField('captureRequestContent', value)}
                onPrune={service.pruneLogs}
              />
              {import.meta.env.DEV && (
                <DevelopmentCard onSeedDevelopment={() => void service.seedDevelopmentData()} />
              )}
            </SettingsSection>
          </>
        )}
      </PageContent>

      {!service.loading && service.settings && (
        <div className="sticky bottom-0 z-20 -mx-6 -mb-5 mt-auto border-t border-border/50 bg-card/90 px-6 py-3 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4">
            <p className="system-xs-regular text-text-tertiary">
              {service.saved ? '所有设置已保存' : service.isDirty ? '有尚未保存的更改' : '当前设置已同步'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                disabled={service.saving || !service.isDirty}
                onClick={service.resetSettings}
              >
                <RotateCcw />
                重置
              </Button>
              <Button
                disabled={service.saving || !service.isDirty}
                onClick={() => void service.saveSettings()}
              >
                {service.saving ? <LoaderCircle className="animate-spin" /> : service.saved ? <Check /> : <Save />}
                {service.saving ? '保存中…' : service.saved ? '已保存' : '保存更改'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
