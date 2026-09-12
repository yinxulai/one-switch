import { Database } from 'lucide-react'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow } from '@/components/form-kit'

interface DevelopmentCardProps {
  onSeedDevelopment: () => void
}

export function DevelopmentCard(props: DevelopmentCardProps) {
  return (
    <Card>
      <SettingsCardHeader icon={<Database />} title="开发调试" description="仅在开发环境提供" />
      <CardContent className="divide-y divide-border/50 px-4">
        <FormRow
          title="示例数据"
          description="添加示例供应商、逻辑模型、供应商模型和请求记录，不会覆盖已有配置"
          control={(
            <Button variant="secondary" onClick={props.onSeedDevelopment}>
              <Database className="size-3.5" />
              插入测试数据
            </Button>
          )}
        />
      </CardContent>
    </Card>
  )
}
