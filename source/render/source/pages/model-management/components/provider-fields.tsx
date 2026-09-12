import { KeyRound } from 'lucide-react'
import { FormField } from '@/components/form-kit'
import { Input } from '@/components/ui/input'

interface ProviderFieldsProps {
  editingProviderId: string | null
  providerName: string
  apiKey: string
  timeout: string
  setProviderName: (name: string) => void
  setApiKey: (key: string) => void
  setTimeout: (timeout: string) => void
}

export function ProviderFields(props: ProviderFieldsProps) {
  const { editingProviderId, providerName, apiKey, timeout, setProviderName, setApiKey, setTimeout } = props

  return (
    <div className="grid gap-4">
      <FormField label="供应商名称" htmlFor="provider-name">
        <Input
          id="provider-name"
          value={providerName}
          onChange={event => setProviderName(event.target.value)}
          placeholder="例如：OpenAI / DeepSeek"
        />
      </FormField>

      <FormField
        label="API Key（可选）"
        htmlFor="provider-key"
        hint="仅保存在本机；无需鉴权的上游可以留空。"
      >
        <div className="relative">
          <KeyRound aria-hidden className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-text-tertiary" />
          <Input
            id="provider-key"
            type="password"
            className="pl-9"
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
            placeholder={editingProviderId ? '留空表示不修改' : '可选，例如 sk-...'}
          />
        </div>
      </FormField>

      <FormField
        label="请求超时（毫秒）"
        htmlFor="provider-timeout"
        hint="超时后自动切换下一个候选模型，默认 30 秒（30000 毫秒）。"
      >
        <Input
          id="provider-timeout"
          type="number"
          min={1}
          value={timeout}
          onChange={event => setTimeout(event.target.value)}
          placeholder="例如：30000"
        />
      </FormField>
    </div>
  )
}
