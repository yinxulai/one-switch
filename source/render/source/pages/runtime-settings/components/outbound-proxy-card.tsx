import { useState } from 'react'
import { CheckCircle2, Loader2, Network, PlugZap, XCircle } from 'lucide-react'
import type { OutboundProxyMode } from '@common/schemas'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FormRow, FormSelect, type FormOption } from '@/components/form-kit'
import { Input } from '@/components/ui/input'
import { SettingsCardHeader } from '@/components/settings-card-header'
import { useOutboundProxyTest } from '../hooks/use-outbound-proxy-test'

interface OutboundProxyCardProps {
  mode: OutboundProxyMode
  proxyUrl: string
  bypass: string
  onModeChange: (value: OutboundProxyMode) => void
  onProxyUrlChange: (value: string) => void
  onBypassChange: (value: string) => void
}

const MODE_OPTIONS: FormOption[] = [
  { value: 'direct', label: '不使用任何代理' },
  { value: 'system', label: '使用系统代理' },
  { value: 'custom', label: '自定义代理' },
]

const MODE_DESCRIPTIONS: Record<OutboundProxyMode, string> = {
  direct: '所有上游请求强制直连，不使用任何代理',
  system: '跟随操作系统的代理设置',
  custom: '使用下方指定的 HTTP、HTTPS 或 SOCKS 代理',
}

export function OutboundProxyCard(props: OutboundProxyCardProps) {
  const test = useOutboundProxyTest()
  const [targetUrl, setTargetUrl] = useState('https://www.gstatic.com/generate_204')

  return (
    <Card>
      <SettingsCardHeader icon={<Network />} title="上游代理" description="控制 One Switch 访问模型服务时使用的网络路径" />
      <CardContent className="px-4">
        <div className="divide-y divide-border/50">
          <FormRow
            title="代理模式"
            description={MODE_DESCRIPTIONS[props.mode]}
            control={(
              <FormSelect
                ariaLabel="代理模式"
                className="w-44"
                options={MODE_OPTIONS}
                value={props.mode}
                onValueChange={value => props.onModeChange(value as OutboundProxyMode)}
              />
            )}
          />

          {props.mode === 'custom' && (
            <>
              <FormRow
                title="代理 URL"
                description="凭据会保存在本机，仅使用可信代理"
                control={(
                  <Input
                    id="outbound-proxy-url"
                    aria-label="代理 URL"
                    className="w-80 font-mono"
                    value={props.proxyUrl}
                    onChange={event => props.onProxyUrlChange(event.target.value)}
                    placeholder="http://user:password@127.0.0.1:7890"
                  />
                )}
              />
              <FormRow
                title="直连地址"
                description="逗号分隔，支持 *.example.com 和 <local>"
                control={(
                  <Input
                    id="outbound-proxy-bypass"
                    aria-label="直连地址"
                    className="w-80 font-mono"
                    value={props.bypass}
                    onChange={event => props.onBypassChange(event.target.value)}
                    placeholder="localhost,127.0.0.1,::1"
                  />
                )}
              />
            </>
          )}

          <FormRow
            title="连接测试"
            description="用当前配置请求一次轻量地址，验证代理是否可用"
            control={(
              <>
                <Input
                  aria-label="连接测试地址"
                  className="w-72 font-mono"
                  value={targetUrl}
                  onChange={event => setTargetUrl(event.target.value)}
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={test.status === 'running' || (props.mode === 'custom' && !props.proxyUrl.trim())}
                  onClick={() => void test.run({ mode: props.mode, proxyUrl: props.proxyUrl, bypass: props.bypass, targetUrl })}
                >
                  {test.status === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                  {test.status === 'running' ? '测试中' : '测试连接'}
                </Button>
              </>
            )}
          />
        </div>

        {test.status === 'success' && test.result && (
          <Alert className="mt-1 mb-1 border-0 bg-success/10 text-text-success">
            <CheckCircle2 />
            <AlertDescription className="text-current">连接成功，HTTP {test.result.statusCode}，耗时 {test.result.durationMilliseconds} ms</AlertDescription>
          </Alert>
        )}
        {test.status === 'error' && (
          <Alert variant="destructive" className="mt-1 mb-1 border-0 bg-destructive/10">
            <XCircle />
            <AlertDescription>{test.errorMessage}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
