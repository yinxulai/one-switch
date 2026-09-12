import type { ReactNode } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { cn } from '@/lib/utils'

interface RowValueProps {
  children: ReactNode
  mono?: boolean
}

interface ClientSetupCardProps {
  onNavigateToModels?: () => void
}

function RowValue(props: RowValueProps) {
  const { children, mono = false } = props
  return <span className={cn('system-xs-regular text-text-secondary', mono && 'font-mono')}>{children}</span>
}

export function ClientSetupCard(props: ClientSetupCardProps) {
  const { onNavigateToModels } = props
  return (
    <Card>
      <SettingsCardHeader
        icon={<KeyRound />}
        title="客户端配置"
        description="本地服务不校验鉴权，真实的上游凭证由 One Switch 按供应商注入"
      />
      <CardContent className="divide-y divide-border/50">
        <FormRow
          title="模型名"
          description="客户端填任意模型 ID 都能用：命中逻辑模型就直连它，没命中回落到默认逻辑模型"
          control={<RowValue mono>default</RowValue>}
        />
        <FormRow
          title="API Key"
          description="本地服务无需鉴权，客户端强制要求填写时用任意值即可"
          control={<RowValue>任意值</RowValue>}
        />
        <FormRow
          title="上游凭证"
          description="各供应商的 API Key 在模型管理中维护，客户端无需感知"
          control={onNavigateToModels && (
            <Button variant="outline" size="sm" onClick={onNavigateToModels}>前往模型管理</Button>
          )}
        />
      </CardContent>
    </Card>
  )
}
