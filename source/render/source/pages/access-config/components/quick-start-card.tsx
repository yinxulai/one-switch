import { ListOrdered } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsCardHeader } from '@/components/settings-card-header'

interface QuickStartStep {
  title: string
  description: string
}

const STEPS: QuickStartStep[] = [
  { title: '复制接入地址', description: '在上方按客户端支持的协议复制地址' },
  { title: '填进客户端', description: '粘贴为 Base URL，模型名填任意值' },
  { title: '配置上游凭证', description: '在模型管理里填各供应商的 API Key' },
]

export function QuickStartCard() {
  return (
    <Card>
      <SettingsCardHeader icon={<ListOrdered />} title="快速开始" description="三步把客户端接到 One Switch" />
      <CardContent className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <div key={step.title} className="flex gap-2.5">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 system-2xs-medium text-primary">{index + 1}</span>
            <div className="min-w-0">
              <p className="system-sm-medium text-text-primary">{step.title}</p>
              <p className="mt-0.5 system-xs-regular text-text-tertiary">{step.description}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
