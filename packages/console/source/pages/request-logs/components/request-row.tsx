import { CheckCircle2, XCircle } from 'lucide-react'
import type { RequestLogEntry } from '@common/schemas'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { useLocale, useTranslation } from '@/i18n/provider'
import { PROTOCOL_LABEL, formatDuration, formatStatus, formatTime } from '../lib/format'

interface RequestRowProps {
  log: RequestLogEntry
}

export function RequestRow(props: RequestRowProps) {
  const t = useTranslation()
  const locale = useLocale()
  const { log } = props

  const succeeded = log.status === 'success'
  const lastAttempt = log.attempts[log.attempts.length - 1]
  // 上游协议只是尝试级事实：一次请求可能先后走过不同协议的尝试。
  const upstreamProtocol = lastAttempt?.upstreamProtocol

  return (
    <div className="flex items-start gap-3 border-b border-border/40 px-4 py-3 last:border-b-0">
      <div className="mt-0.5 shrink-0">
        {succeeded
          ? <CheckCircle2 size={16} className="text-text-success" aria-hidden />
          : <XCircle size={16} className="text-text-destructive" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1 grid gap-1">
        <div className="flex flex-wrap items-center gap-2 system-xs-regular">
          <span className="system-xs-medium text-text-primary">
            {lastAttempt ? lastAttempt.providerName : log.logicalModelId}
          </span>
          <span className="font-mono text-text-tertiary">
            {lastAttempt?.providerModelName ?? '—'}
          </span>
          <Badge variant={succeeded ? 'success' : 'destructive'}>
            {formatStatus(t, log.status)}
          </Badge>
          <span className="text-text-tertiary">
            {log.clientProtocol === null ? t('requestLogs.detail.unrecognizedProtocol') : PROTOCOL_LABEL[log.clientProtocol] ?? log.clientProtocol}
            {upstreamProtocol && upstreamProtocol !== log.clientProtocol && (
              <>
                {' '}
                <span className="text-text-quaternary">→</span>{' '}
                <span className="text-text-warning">
                  {PROTOCOL_LABEL[upstreamProtocol] ?? upstreamProtocol}
                </span>
              </>
            )}
          </span>
          <span className="text-text-quaternary">{formatTime(locale, log.createdTime)}</span>
        </div>
        {log.attempts.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {log.attempts.map((attempt, i) => (
              <span
                key={i}
                className={cn(
                  'rounded-md px-1.5 py-0.5 system-2xs-regular',
                  attempt.status === 'success'
                    ? 'bg-success/10 text-text-success'
                    : 'bg-destructive/10 text-text-destructive',
                )}
                title={attempt.errorMessage ?? undefined}
              >
                {t('requestLogs.attempt.label', { index: i + 1 })}: {attempt.providerName}/{attempt.providerModelName} ·{' '}
                {formatDuration(attempt.durationMilliseconds)}
              </span>
            ))}
          </div>
        )}
        {log.attempts.length === 1 && (
          <div className="system-xs-regular text-text-tertiary">
            {t('requestLogs.table.duration')} {formatDuration(log.totalDurationMilliseconds)}
            {log.totalTokens != null ? ` · ${log.totalTokens} tokens` : ''}
          </div>
        )}
      </div>
    </div>
  )
}
