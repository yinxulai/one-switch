import * as React from 'react'
import { AlertCircle, ChevronDown, LoaderCircle, Search } from 'lucide-react'
import type { AppliedRequestRewriteRule, AttemptContent, RequestContent, RequestLogEntryAttempt } from '@common/schemas'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { formatContent, isLocalFailureBody } from '../lib/format-content'
import { PROTOCOL_LABEL } from '../lib/format'

interface ContentSectionProps {
  id: string
  label: string
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface RequestStageSection {
  id: string
  label: string
  value: string | null
}

interface RequestStageProps {
  title: string
  /** 已经本地化的协议名。 */
  protocol: string
  /** 该阶段的响应状态；`null` 表示该阶段没有可展示的状态（如尚未拿到正文）。 */
  statusLabel: string | null
  sections: RequestStageSection[]
  sectionStates: Record<string, boolean>
  onSectionOpenChange: (id: string, open: boolean) => void
}

interface AppliedRulesProps {
  ruleIds: string[]
  rules: AppliedRequestRewriteRule[] | null
}

interface AttemptErrorProps {
  attempt: RequestLogEntryAttempt
}

interface RequestContentsSheetProps {
  /** 客户端视角正文；每个请求至多一行。 */
  contents: RequestContent[] | null
  /** 上游视角正文；每次尝试至多一行。 */
  attemptContents: AttemptContent[] | null
  attempts: RequestLogEntryAttempt[]
  requestRewriteRules: AppliedRequestRewriteRule[] | null
  /** 客户端协议；`null` 表示该请求连 API 路径都未识别。 */
  clientProtocol: string | null
  upstreamProtocol?: string | null
  loading: boolean
  error: string | null
  selectedAttemptId: string | null
  onClose: () => void
}

function sectionKey(title: string, label: string) {
  return `${title}::${label}`
}

/** 协议枚举值转展示名；`null` 表示这次请求根本没识别出该协议。 */
function protocolLabel(protocol: string | null): string {
  if (protocol === null) return '未知协议'
  return PROTOCOL_LABEL[protocol] ?? protocol
}

interface AttemptFactsProps {
  attempt: RequestLogEntryAttempt
}

interface FactItem {
  label: string
  value: string
}

/** 时间戳是事实本身，展示时才变成可读时间。 */
function formatCreatedTime(time: number): string {
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? String(time) : date.toLocaleString('zh-CN', { hour12: false })
}

function factsOf(attempt: RequestLogEntryAttempt): FactItem[] {
  return [
    { label: '尝试 ID', value: attempt.id },
    { label: '尝试序号', value: String(attempt.attemptIndex + 1) },
    { label: '状态', value: attempt.status },
    { label: 'Provider ID', value: attempt.providerId },
    { label: '供应商模型 ID', value: attempt.providerModelId },
    { label: '上游协议', value: attempt.upstreamProtocol ?? '未识别' },
    { label: '上游 request ID', value: attempt.upstreamRequestId ?? '无' },
    { label: '上游 URL', value: attempt.url },
    { label: 'HTTP 状态', value: attempt.httpStatus === null ? '未收到响应' : String(attempt.httpStatus) },
    { label: '可重试', value: attempt.retryable ? '是' : '否' },
    { label: '上游流式', value: attempt.streaming === null ? '未知' : attempt.streaming ? 'SSE' : '非流式' },
    { label: '首字延迟', value: attempt.ttftMilliseconds === null ? '无输出' : `${attempt.ttftMilliseconds} ms` },
    { label: '耗时', value: `${attempt.durationMilliseconds} ms` },
    { label: '错误码', value: attempt.errorCode ?? '无' },
    { label: '错误信息', value: attempt.errorMessage ?? '无' },
    { label: '命中的请求改写规则', value: attempt.requestRewriteRuleIds.join(', ') || '无' },
    { label: '命中的响应改写规则', value: attempt.responseRewriteRuleIds.join(', ') || '无' },
    { label: '创建时间', value: formatCreatedTime(attempt.createdTime) },
  ]
}

/**
 * 尝试级的事实清单。
 *
 * 这些字段单独看都很小，但排障时缺任何一个都会让人回头去查库，因此整体列出。
 */
function AttemptFacts(props: AttemptFactsProps) {
  return (
    <section className="overflow-hidden rounded-md bg-inset">
      <div className="bg-muted/30 px-3 py-2 text-xs font-medium">本次尝试事实</div>
      <dl className="grid gap-x-4 gap-y-1.5 px-3 py-2.5 md:grid-cols-2">
        {factsOf(props.attempt).map(fact => (
          <div key={fact.label} className="flex min-w-0 items-baseline gap-2 text-[11px]">
            <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
            <dd className="min-w-0 wrap-break-word font-mono text-foreground/90">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function ContentSection(props: ContentSectionProps) {
  const content = formatContent(props.value)

  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange} className="overflow-hidden rounded-md bg-inset">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 bg-muted/30 px-3 py-2.5 text-left text-xs font-medium hover:bg-muted/50">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{props.label}</span>
          {content.isJson && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">JSON</span>}
        </span>
        <ChevronDown size={15} className={cn('shrink-0 text-muted-foreground transition-transform', !props.open && '-rotate-90')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="whitespace-pre-wrap break-all bg-inset p-3 font-mono text-xs leading-5 text-foreground/90">{content.value}</pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function AppliedRules(props: AppliedRulesProps) {
  if (props.ruleIds.length === 0) return null
  const ruleNames = new Map(props.rules?.map(rule => [rule.id, rule.name]) ?? [])

  return (
    <section className="rounded-lg bg-info/8 px-3 py-2.5">
      <div className="text-xs font-medium">已应用修改器</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {props.ruleIds.map(id => <span key={id} className="rounded bg-info/15 px-1.5 py-0.5 text-[10px] text-info">{ruleNames.get(id) ?? id}</span>)}
      </div>
    </section>
  )
}

function RequestStage(props: RequestStageProps) {
  const sections = props.sections.filter(section => section.value)
  if (sections.length === 0) return null

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-muted/20">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5 text-sm font-medium">
        <span>{props.title}</span>
        <span className="font-mono text-xs text-muted-foreground">· {props.protocol}</span>
        {props.statusLabel && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
            {props.statusLabel}
          </span>
        )}
      </div>
      <div className="space-y-2 px-2 pb-2 pt-2">
        {sections.map(section => (
          <ContentSection
            key={section.id}
            id={section.id}
            label={section.label}
            value={section.value!}
            open={props.sectionStates[section.id] ?? true}
            onOpenChange={open => props.onSectionOpenChange(section.id, open)}
          />
        ))}
      </div>
    </section>
  )
}

function AttemptError(props: AttemptErrorProps) {
  const { attempt } = props
  if (!attempt.errorCode && !attempt.errorMessage) return null

  return (
    <section className="rounded-lg bg-red-500/8 px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2 font-medium text-red-700 dark:text-red-300">
        <AlertCircle size={14} />
        <span>{attempt.httpStatus !== null ? `HTTP ${attempt.httpStatus}` : '上游请求失败'}</span>
        {attempt.errorCode && <span className="font-mono text-[10px] font-normal">{attempt.errorCode}</span>}
      </div>
      {attempt.errorMessage && <div className="mt-1 wrap-break-word text-red-700/90 dark:text-red-300/90">{attempt.errorMessage}</div>}
    </section>
  )
}

type RequestStageData = Omit<RequestStageProps, 'sectionStates' | 'onSectionOpenChange'>

type RequestStageBuilderInput = {
  /** 客户端视角正文。 */
  clientContent: RequestContent | null
  /** 选中尝试对应的上游视角正文。 */
  attemptContent: AttemptContent | null
  /** 本次尝试的客户端协议；未知时为 `null`。 */
  clientProtocol: string | null
  /** 本次尝试实际发往上游的协议。 */
  upstreamProtocol: string | null
  /** 客户端协议与上游协议不一致，即发生过协议转换。 */
  converted: boolean
}

function buildRequestStages(input: RequestStageBuilderInput): RequestStageData[] {
  const { clientContent, attemptContent, clientProtocol, upstreamProtocol, converted } = input
  const clientLabel = protocolLabel(clientProtocol)
  const upstreamLabel = protocolLabel(upstreamProtocol)
  const upstreamRequestTitle = converted ? '协议转换后的上游请求' : '发送到真实供应商的请求'
  const clientResponseTitle = converted ? '协议转换后的客户端响应' : '返回客户端的响应'
  // 本地失败时上游一个字节都没回。这条正文记的是本地观察到的失败原因，
  // 叫它「上游响应」会让人以为是上游回的内容。
  const upstreamResponseBodyIsLocalFailure = isLocalFailureBody(attemptContent?.responseBody ?? null)

  // 四个阶段的取值直接来自它所属的表：
  //   客户端原始请求 / 返回客户端的响应 -> request_contents（客户端视角）
  //   发送到供应商的请求 / 供应商响应   -> attempt_contents（上游视角）
  return [
    {
      title: '客户端原始请求',
      protocol: clientLabel,
      statusLabel: null,
      sections: [
        { id: sectionKey('客户端原始请求', `请求头 · ${clientLabel}`), label: `请求头 · ${clientLabel}`, value: clientContent?.requestHeaders ?? null },
        { id: sectionKey('客户端原始请求', `请求 Body · ${clientLabel}`), label: `请求 Body · ${clientLabel}`, value: clientContent?.requestBody ?? null },
      ],
    },
    {
      title: upstreamRequestTitle,
      protocol: upstreamLabel,
      statusLabel: null,
      sections: [
        { id: sectionKey(upstreamRequestTitle, `请求头 · ${upstreamLabel}`), label: `请求头 · ${upstreamLabel}`, value: attemptContent?.requestHeaders ?? null },
        { id: sectionKey(upstreamRequestTitle, `请求 Body · ${upstreamLabel}`), label: `请求 Body · ${upstreamLabel}`, value: attemptContent?.requestBody ?? null },
      ],
    },
    {
      title: '真实供应商响应',
      protocol: upstreamLabel,
      statusLabel: attemptContent ? (attemptContent.responseStatus === null ? '上游未返回响应' : `HTTP ${attemptContent.responseStatus}`) : null,
      sections: [
        { id: sectionKey('真实供应商响应', `响应头 · ${upstreamLabel}`), label: `响应头 · ${upstreamLabel}`, value: attemptContent?.responseHeaders ?? null },
        {
          id: sectionKey('真实供应商响应', `响应 Body · ${upstreamLabel}`),
          label: upstreamResponseBodyIsLocalFailure ? '本地失败原因 · 上游未返回响应' : `响应 Body · ${upstreamLabel}`,
          value: attemptContent?.responseBody ?? null,
        },
      ],
    },
    {
      title: clientResponseTitle,
      protocol: clientLabel,
      statusLabel: clientContent ? (clientContent.responseStatus === null ? '未返回响应' : `HTTP ${clientContent.responseStatus}`) : null,
      sections: [
        { id: sectionKey(clientResponseTitle, `响应头 · ${clientLabel}`), label: `响应头 · ${clientLabel}`, value: clientContent?.responseHeaders ?? null },
        { id: sectionKey(clientResponseTitle, `响应 Body · ${clientLabel}`), label: `响应 Body · ${clientLabel}`, value: clientContent?.responseBody ?? null },
      ],
    },
  ]
}

export function RequestContentsSheet(props: RequestContentsSheetProps) {
  const selectedAttempt = props.attempts.find(attempt => attempt.id === props.selectedAttemptId) ?? null
  const attemptContent = props.attemptContents?.find(content => content.attemptId === props.selectedAttemptId) ?? null
  // 客户端视角每个请求只有一行，不需要按 attemptId 筛选。
  const clientContent = props.contents?.[0] ?? null
  const [search, setSearch] = React.useState('')
  const [sectionStates, setSectionStates] = React.useState<Record<string, boolean>>({})

  // 「发生过协议转换」不是独立事实：客户端协议与本次尝试的上游协议不同即为转换。
  const clientProtocol = props.clientProtocol
  const upstreamProtocol = selectedAttempt?.upstreamProtocol ?? null
  const converted = clientProtocol !== null && upstreamProtocol !== null && clientProtocol !== upstreamProtocol

  React.useEffect(() => {
    setSearch('')
    setSectionStates({})
  }, [props.selectedAttemptId])

  const stages: RequestStageProps[] = buildRequestStages({
    clientContent,
    attemptContent,
    clientProtocol,
    upstreamProtocol,
    converted,
  }).map(stage => ({
    ...stage,
    sectionStates,
    onSectionOpenChange: (id, open) => setSectionStates(current => ({ ...current, [id]: open })),
  }))

  const normalizedSearch = search.trim().toLowerCase()
  const filteredStages = normalizedSearch
    ? stages
        .map(stage => ({
          ...stage,
          sections: stage.sections.filter(section => `${section.label} ${section.value ?? ''}`.toLowerCase().includes(normalizedSearch)),
        }))
        .filter(stage => stage.sections.length > 0)
    : stages
  const visibleSectionIds = filteredStages.flatMap(stage => stage.sections.map(section => section.id))

  let state: React.ReactNode
  if (props.loading) {
    state = (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <LoaderCircle size={15} className="animate-spin" />
        正在加载正文
      </div>
    )
  } else if (props.error) {
    state = (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-red-600 dark:text-red-400">
        <AlertCircle size={15} />
        {props.error}
      </div>
    )
  } else if (selectedAttempt || clientContent) {
    state = (
      <div className="flex h-full min-h-0 flex-col">
        <div className="sticky top-0 z-10 border-b border-border/60 bg-card/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="搜索请求详情内容"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="搜索内容"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={visibleSectionIds.length === 0}
              onClick={() => setSectionStates(current => {
                const next = { ...current }
                visibleSectionIds.forEach(id => { next[id] = true })
                return next
              })}
            >
              全展开
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={visibleSectionIds.length === 0}
              onClick={() => setSectionStates(current => {
                const next = { ...current }
                visibleSectionIds.forEach(id => { next[id] = false })
                return next
              })}
            >
              全折叠
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 pt-3">
          {selectedAttempt && <AttemptError attempt={selectedAttempt} />}
          {selectedAttempt && <AttemptFacts attempt={selectedAttempt} />}
          <AppliedRules ruleIds={selectedAttempt ? [...selectedAttempt.requestRewriteRuleIds, ...selectedAttempt.responseRewriteRuleIds] : []} rules={props.requestRewriteRules} />
          {filteredStages.length > 0 ? (
            filteredStages.map(stage => <RequestStage key={stage.title} {...stage} />)
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">未找到匹配内容</div>
          )}
        </div>
      </div>
    )
  } else if (props.selectedAttemptId) {
    state = <div className="py-8 text-center text-sm text-muted-foreground">该尝试没有可查看的记录</div>
  } else {
    state = null
  }

  return (
    <Sheet open={Boolean(props.selectedAttemptId)} onOpenChange={open => !open && props.onClose()}>
      <SheetContent side="right" className="flex h-full w-full max-w-3xl! flex-col gap-0 border-0 bg-card p-0 shadow-none" onOpenAutoFocus={event => event.preventDefault()}>
        <SheetHeader className="shrink-0 px-4 py-3.5 pr-12">
          <SheetTitle className="text-sm">请求详情</SheetTitle>
          <SheetDescription className="text-xs">按请求链路和采集时的原始字符串展示</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-hidden">{state}</div>
      </SheetContent>
    </Sheet>
  )
}
