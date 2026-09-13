import { Globe2, Link2, Power, ScrollText } from 'lucide-react'
import { MetricGrid } from '@/components/metric-grid'
import { useTranslation } from '@/i18n/provider'
import type { RequestRewriteRule } from '../types'

interface RuleStatsProps {
  rules: RequestRewriteRule[]
}

export function RuleStats(props: RuleStatsProps) {
  const t = useTranslation()
  return (
    <MetricGrid items={[
      { label: t('rules.stats.all'), value: props.rules.length, Icon: ScrollText },
      { label: t('rules.stats.global'), value: props.rules.filter(rule => rule.global).length, Icon: Globe2 },
      { label: t('rules.stats.normal'), value: props.rules.filter(rule => !rule.global).length, Icon: Link2 },
      { label: t('rules.stats.enabled'), value: props.rules.filter(rule => rule.enabled).length, Icon: Power },
    ]} />
  )
}
