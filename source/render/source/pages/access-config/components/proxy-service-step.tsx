import { useNavigate } from '@tanstack/react-router'
import { routePaths } from '@/routes'
import { cn } from '@/lib/utils'
import { FormRow } from '@/components/form-kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/provider'
import type { AppTranslator } from '@/i18n/provider'
import { StepCard } from './step-card'

interface ProxyServiceStepProps {
  running: boolean
  host: string
  port: number | null
  /** 监听在 0.0.0.0 / :: 上时，回环地址才是本机客户端该用的地址。 */
  wildcardHost: boolean
}

/** 把监听配置翻成一句人话：通配监听时顺手给出本机客户端该填的地址。 */
function describeListening(t: AppTranslator, host: string, port: number | null, wildcardHost: boolean): string {
  if (!host || port === null) return t('access.step.service.reading')
  if (wildcardHost) return t('access.step.service.listeningWildcard', { host, port })
  return t('access.step.service.listening', { host, port })
}

/**
 * 第一步：代理是客户端的唯一入口，它不在跑，后面两步填什么都没用，
 * 所以状态、监听范围和启停入口都压在这一张卡里（启停按钮在页头，和运行状态同屏）。
 */
export function ProxyServiceStep(props: ProxyServiceStepProps) {
  const { running, host, port, wildcardHost } = props
  const navigate = useNavigate()
  const t = useTranslation()
  return (
    <StepCard
      index={1}
      title={t('access.step.service.title')}
      description={describeListening(t, host, port, wildcardHost)}
      actions={(
        <Badge variant={running ? 'success' : 'muted'}>
          <span
            className={cn(
              'size-1.5 rounded-full',
              running ? 'bg-success-foreground motion-safe:animate-pulse' : 'bg-text-quaternary',
            )}
          />
          {running ? t('access.step.service.running') : t('access.step.service.stopped')}
        </Badge>
      )}
    >
      <FormRow
        title={t('access.step.service.reachTitle')}
        description={wildcardHost ? t('access.step.service.reachAll') : t('access.step.service.reachLocal')}
        control={(
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate({ to: routePaths.runtimeSettings })}
          >
            {t('access.step.service.changeHost')}
          </Button>
        )}
      />
    </StepCard>
  )
}
