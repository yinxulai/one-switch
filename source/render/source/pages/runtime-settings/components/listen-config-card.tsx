import { RadioTower } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'
import { Input } from '@/components/ui/input'

interface ListenConfigCardProps {
  listenHost: string
  listenPort: number
  proxyRunning: boolean
  onHostChange: (value: string) => void
  onPortChange: (value: number) => void
}

export function ListenConfigCard(props: ListenConfigCardProps) {
  const { listenHost, listenPort, proxyRunning, onHostChange, onPortChange } = props

  return (
    <Card>
      <SettingsCardHeader
        icon={<RadioTower />}
        title="监听服务"
        description="设置本地代理的访问地址"
        actions={<Badge variant={proxyRunning ? 'success' : 'muted'}>{proxyRunning ? '运行中' : '已停止'}</Badge>}
      />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title="监听地址"
          description="推荐 127.0.0.1，仅允许本机访问"
          control={(
            <Input
              id="listen-host"
              aria-label="监听地址"
              className="w-56 font-mono"
              placeholder="127.0.0.1"
              value={listenHost}
              onChange={event => onHostChange(event.target.value)}
            />
          )}
        />
        <FormRow
          title="监听端口"
          description="保存后代理会自动使用新端口"
          control={(
            <Input
              id="listen-port"
              aria-label="监听端口"
              className="w-24 text-right"
              max={65535}
              min={1}
              placeholder="9300"
              type="number"
              value={listenPort}
              onChange={event => onPortChange(Number(event.target.value))}
            />
          )}
        />
      </CardContent>
    </Card>
  )
}
