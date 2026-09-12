import * as React from 'react'
import { AlertCircle, Check, ChevronDown, ChevronUp, Copy, LoaderCircle, Search } from 'lucide-react'
import type { AppliedRequestRewriteRule, AttemptContent, RequestContent, RequestLogEntryAttempt } from '@common/schemas'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { searchBlocks, type ContentSearchResult, type SectionHighlight } from '../lib/content-search'
import { formatContent, isLocalFailureBody } from '../lib/format-content'
import { PROTOCOL_LABEL, distinctAttemptErrorCode, distinctAttemptErrorMessage, formatAttemptOutcome } from '../lib/format'

interface ContentSectionProps {
  id: string
  label: string
  value: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 命中高亮；没有搜索词时为 `null`，此时整段按普通文本渲染。 */
  highlight: SectionHighlight | null
  /** 当前激活的命中序号（全局），用于定位与强调。 */
  activeMatchIndex: number | null
}

interface CopyButtonProps {
  value: string
  /** 可访问名，例如「复制请求 Body」。 */
  label: string
  className?: string
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
  search: ContentSearchResult
  /** 当前激活的命中序号（全局）；没有搜索词时为 `null`。 */
  activeMatchIndex: number | null
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
  /** 内部 id、URL、规则 id 这类只在深挖时才看的事实，默认收进「更多事实」。 */
  advanced?: boolean
}

/** 时间戳是事实本身，展示时才变成可读时间。 */
function formatCreatedTime(time: number): string {
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? String(time) : date.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 尝试级事实。
 *
 * 前面几项是排障第一眼就要看的结论与性能；内部 id、URL、规则 id 是回头查库才用到的，
 * 列为「更多事实」，默认收起。错误码/错误信息也放在收起区：它们已经由顶部横幅预告过一次，
 * 这里只是为了让「复制本次尝试事实」拿到完整记录。
 *
 * 不再列「结果」：`SheetTitle` 里的结果 chip 就紧挨在上面，写两遍只是同义反复。
 */
function factsOf(attempt: RequestLogEntryAttempt): FactItem[] {
  const errorCode = distinctAttemptErrorCode(attempt)
  const errorMessage = distinctAttemptErrorMessage(attempt)

  return [
    { label: 'Provider', value: attempt.providerName },
    { label: '上游模型', value: attempt.providerModelName },
    { label: '上游协议', value: attempt.upstreamProtocol ?? '未识别' },
    { label: '上游流式', value: attempt.streaming === null ? '未知' : attempt.streaming ? 'SSE' : '非流式' },
    { label: '首字延迟', value: attempt.ttftMilliseconds === null ? '无输出' : `${attempt.ttftMilliseconds} ms` },
    { label: '耗时', value: `${attempt.durationMilliseconds} ms` },
    { label: '可重试', value: attempt.retryable ? '是' : '否' },
    ...(errorCode ? [{ label: '错误码', value: errorCode, advanced: true }] : []),
    ...(errorMessage ? [{ label: '错误信息', value: errorMessage, advanced: true }] : []),
    { label: '尝试序号', value: String(attempt.attemptIndex + 1), advanced: true },
    { label: '尝试 ID', value: attempt.id, advanced: true },
    { label: 'Provider ID', value: attempt.providerId, advanced: true },
    { label: '上游模型 ID', value: attempt.providerModelId, advanced: true },
    { label: '上游请求 ID', value: attempt.upstreamRequestId ?? '无', advanced: true },
    { label: '上游 URL', value: attempt.url, advanced: true },
    { label: '命中的请求改写规则', value: attempt.requestRewriteRuleIds.join(', ') || '无', advanced: true },
    { label: '命中的响应改写规则', value: attempt.responseRewriteRuleIds.join(', ') || '无', advanced: true },
    { label: '创建时间', value: formatCreatedTime(attempt.createdTime), advanced: true },
  ]
}

/**
 * 复制按钮。
 *
 * 每个内容块自带一个，只复制该块展示出来的文本：用户看到什么就拿到什么，
 * 不需要自己去拼上下文。复制成功的反馈放在按钮上，不再弹 toast 干扰排障视线。
 */
function CopyButton(props: CopyButtonProps) {
  const toast = useToast()
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value)
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制失败')
    }
  }

  return (
    <button
      type="button"
      aria-label={copied ? '已复制' : props.label}
      title={copied ? '已复制' : props.label}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        copied && 'text-text-success',
        props.className,
      )}
      onClick={event => {
        // 这个按钮可能与可折叠标题相邻，避免顺带触发展开 / 收起。
        event.stopPropagation()
        void copy()
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

/**
 * 尝试级的事实清单。
 *
 * 这些字段单独看都很小，但排障时缺任何一个都会让人回头去查库，因此整体列出：
 * 只是把「第一眼要看的」与「回头查库才用的」分成两档，后者默认收起。
 */
function AttemptFacts(props: AttemptFactsProps) {
  const facts = factsOf(props.attempt)
  const [expanded, setExpanded] = React.useState(false)
  const primary = facts.filter(fact => !fact.advanced)
  const advanced = facts.filter(fact => fact.advanced)
  const visible = expanded ? [...primary, ...advanced] : primary

  // 换一次尝试就收起来，免得上一条的展开状态串到下一条。
  React.useEffect(() => setExpanded(false), [props.attempt.id])

  return (
    <section className="overflow-hidden rounded-lg border border-module-border">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
        <span className="system-sm-medium text-text-primary">本次尝试事实</span>
        <CopyButton
          className="ml-auto"
          label="复制本次尝试事实"
          value={facts.map(fact => `${fact.label}：${fact.value}`).join('\n')}
        />
      </div>
      <dl className="grid gap-x-4 gap-y-1.5 px-3 py-3 md:grid-cols-2">
        {visible.map(fact => (
          <div key={fact.label} className="flex min-w-0 items-baseline gap-2 system-2xs-regular">
            <dt className="shrink-0 text-text-tertiary">{fact.label}</dt>
            <dd className="min-w-0 wrap-break-word font-mono text-text-secondary">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {advanced.length > 0 && (
        <div className="border-t border-border/50 px-3 py-2">
          <button
            type="button"
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 system-2xs-regular text-text-tertiary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => setExpanded(value => !value)}
          >
            <ChevronDown size={12} aria-hidden className={cn('transition-transform', !expanded && '-rotate-90')} />
            {expanded ? '收起更多事实' : `更多事实（${advanced.length}）`}
          </button>
        </div>
      )}
    </section>
  )
}

function ContentSection(props: ContentSectionProps) {
  const content = formatContent(props.value)
  const segments = props.highlight?.segments ?? [{ text: content.value, matchIndex: null }]
  const matchCount = props.highlight?.count ?? 0

  // 内容块自身不再给底色：它已经是「阶段外壳」里的一个分节，再套一层白底
  // 就会在白色 Sheet 上变成看不见的白块。分节靠外壳的 border 与父级 divide-y 划分，
  // 整条链路只保留代码正文这一层凹槽（bg-inset）。
  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      {/* 标题行拆成「折叠触发器 + 复制按钮」两个兄弟节点：按钮嵌在按钮里不合法，
          而拆开后拖动复制不会顺带折叠这块正文。 */}
      <div className="flex items-center transition-colors hover:bg-state-base-hover">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left system-xs-medium text-text-primary">
          <span className="truncate">{props.label}</span>
          {content.isJson && <span className="shrink-0 rounded-md bg-inset px-1.5 py-0.5 font-mono system-2xs-regular text-text-tertiary">JSON</span>}
          {matchCount > 0 && (
            <span className="shrink-0 rounded-md bg-amber-300/70 px-1.5 py-0.5 font-mono system-2xs-regular text-text-primary dark:bg-amber-400/25">
              {matchCount} 处
            </span>
          )}
          <ChevronDown size={15} aria-hidden className={cn('ml-auto shrink-0 text-text-quaternary transition-transform', !props.open && '-rotate-90')} />
        </CollapsibleTrigger>
        <CopyButton className="mr-1.5" label={`复制 ${props.label}`} value={content.value} />
      </div>
      <CollapsibleContent>
        <pre className="mx-3 mb-3 whitespace-pre-wrap break-all rounded-md bg-inset p-3 font-mono text-xs leading-5 text-text-secondary">
          {segments.map((segment, index) => segment.matchIndex === null
            ? <React.Fragment key={index}>{segment.text}</React.Fragment>
            : (
              <mark
                key={index}
                data-search-match={segment.matchIndex}
                className={cn(
                  'rounded-sm',
                  segment.matchIndex === props.activeMatchIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-amber-300/70 text-text-primary dark:bg-amber-400/30',
                )}
              >
                {segment.text}
              </mark>
            ))}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function AppliedRules(props: AppliedRulesProps) {
  if (props.ruleIds.length === 0) return null
  const ruleNames = new Map(props.rules?.map(rule => [rule.id, rule.name]) ?? [])
  // 规则名可能重复，因此展示按 id 去重、复制按名字拼接。
  const appliedRules = props.ruleIds.map(id => ({ id, name: ruleNames.get(id) ?? id }))

  // `bg-info/8` 在亮色下叠白后几乎不可见，因此和 `AttemptFacts` 一样补一圈模块边框，
  // 让「已应用修改器」明确成块。
  return (
    <section className="rounded-lg border border-module-border bg-info/8 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="system-xs-medium text-text-primary">已应用修改器</span>
        <CopyButton className="ml-auto" label="复制已应用修改器" value={appliedRules.map(rule => rule.name).join('\n')} />
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {appliedRules.map(rule => <span key={rule.id} className="rounded-md bg-info/15 px-1.5 py-0.5 system-2xs-medium text-info">{rule.name}</span>)}
      </div>
    </section>
  )
}

function RequestStage(props: RequestStageProps) {
  const sections = props.sections.filter(section => section.value)
  if (sections.length === 0) return null

  // 阶段是这条链路上唯一的一层「外壳」：只留边框，不再铺灰底。
  // 铺灰底会和 Sheet 的 bg-card 形成「白 → 灰 → 白 → 灰」的交替填充，
  // 而白 100% 与灰 92% 只差 8 点明度，边界几乎看不见，整屏就糊成一片。
  return (
    <section className="overflow-hidden rounded-lg border border-module-border">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5 system-sm-medium text-text-primary">
        <span>{props.title}</span>
        <span className="font-mono system-xs-regular text-text-tertiary">· {props.protocol}</span>
        {props.statusLabel && (
          <span className="ml-auto rounded-md bg-inset px-1.5 py-0.5 font-mono system-2xs-regular text-text-tertiary">
            {props.statusLabel}
          </span>
        )}
      </div>
      <div className="divide-y divide-border/50">
        {sections.map(section => (
          <ContentSection
            key={section.id}
            id={section.id}
            label={section.label}
            value={section.value!}
            open={props.sectionStates[section.id] ?? true}
            onOpenChange={open => props.onSectionOpenChange(section.id, open)}
            highlight={props.search.highlights.get(section.id) ?? null}
            activeMatchIndex={props.activeMatchIndex}
          />
        ))}
      </div>
    </section>
  )
}

function AttemptError(props: AttemptErrorProps) {
  const { attempt } = props
  // 只有真正多出信息量的错误码/错误信息才值得这条横幅：
  // HTTP 状态已经写在标题栏和「结果」里各一次，横幅再报一遍就只是重复。
  const code = distinctAttemptErrorCode(attempt)
  const message = distinctAttemptErrorMessage(attempt)
  if (!code && !message) return null

  const errorText = [
    attempt.httpStatus !== null ? `HTTP ${attempt.httpStatus}` : '上游请求失败',
    code,
    message,
  ].filter(Boolean).join('\n')

  return (
    <section className="rounded-lg border border-module-border bg-destructive/8 px-3 py-2.5 system-xs-regular">
      <div className="flex flex-wrap items-center gap-2 system-xs-medium text-text-destructive">
        <AlertCircle size={14} aria-hidden />
        {/* 有状态码时状态码已经在标题栏里，这里只补状态码之外的东西。 */}
        {attempt.httpStatus === null && <span>上游请求失败</span>}
        {code && <span className="font-mono system-2xs-regular">{code}</span>}
        <CopyButton
          className="ml-auto text-text-destructive hover:text-text-destructive"
          label="复制错误信息"
          value={errorText}
        />
      </div>
      {message && <div className="mt-1 wrap-break-word text-text-destructive">{message}</div>}
    </section>
  )
}

type RequestStageData = Omit<RequestStageProps, 'sectionStates' | 'onSectionOpenChange' | 'search' | 'activeMatchIndex'>

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
  const [activeMatchIndex, setActiveMatchIndex] = React.useState(0)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  // 「发生过协议转换」不是独立事实：客户端协议与本次尝试的上游协议不同即为转换。
  const clientProtocol = props.clientProtocol
  const upstreamProtocol = selectedAttempt?.upstreamProtocol ?? null
  const converted = clientProtocol !== null && upstreamProtocol !== null && clientProtocol !== upstreamProtocol

  const stages = React.useMemo<RequestStageData[]>(() => buildRequestStages({
    clientContent,
    attemptContent,
    clientProtocol,
    upstreamProtocol,
    converted,
  }), [clientContent, attemptContent, clientProtocol, upstreamProtocol, converted])

  const sections = React.useMemo(
    () => stages.flatMap(stage => stage.sections).filter(section => section.value !== null),
    [stages],
  )

  // 搜索的是「界面上真正展示的那段文本」，而 JSON 展开、流式拼回都会改变正文，
  // 所以先过一遍 formatContent，确保高亮位置和渲染出来的字符一一对应。
  const searchResult = React.useMemo(
    () => searchBlocks(sections.map(section => ({ id: section.id, text: formatContent(section.value!).value })), search),
    [sections, search],
  )
  const totalMatches = searchResult.matches.length
  const searchQuery = search.trim()

  React.useEffect(() => {
    // 切换 attempt 就清空搜索与展开态。两个 setter 都先比对再写：
    // 写 `{}` 这种新对象即使内容一样也会被判定为新 state，白白多一轮重渲染。
    setSearch(current => (current === '' ? current : ''))
    setSectionStates(current => (Object.keys(current).length === 0 ? current : {}))
  }, [props.selectedAttemptId])

  // 换一个搜索词就回到第一条命中，并把有命中的块展开；
  // 否则高亮会藏在折叠标题底下，而用户看不到任何反应。
  React.useEffect(() => {
    setActiveMatchIndex(current => (current === 0 ? current : 0))
    const matchedIds = new Set(searchResult.matches.map(match => match.sectionId))
    if (matchedIds.size === 0) return
    setSectionStates(current => {
      let changed = false
      const next = { ...current }
      matchedIds.forEach(id => {
        if (!next[id]) {
          next[id] = true
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [searchResult])

  // 命中所在的块可能刚刚被展开才挂到 DOM 上，因此 sectionStates 变化也要重新定位。
  React.useEffect(() => {
    if (totalMatches === 0) return
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-search-match="${activeMatchIndex}"]`)
      ?.scrollIntoView({ block: 'center' })
  }, [activeMatchIndex, totalMatches, sectionStates])

  const jumpToMatch = (delta: number) => {
    if (totalMatches === 0) return
    const next = (activeMatchIndex + delta + totalMatches) % totalMatches
    const sectionId = searchResult.matches[next]?.sectionId
    // 手动折叠过的块，定位到它时要先展开。
    if (sectionId) setSectionStates(current => (current[sectionId] ? current : { ...current, [sectionId]: true }))
    setActiveMatchIndex(next)
  }

  const visibleSectionIds = sections.map(section => section.id)

  let state: React.ReactNode
  if (props.loading) {
    state = (
      <div className="flex items-center justify-center gap-2 py-8 system-sm-regular text-text-tertiary">
        <LoaderCircle size={15} aria-hidden className="animate-spin" />
        正在加载正文
      </div>
    )
  } else if (props.error) {
    state = (
      <div className="flex items-center justify-center gap-2 py-8 system-sm-regular text-text-destructive">
        <AlertCircle size={15} aria-hidden />
        {props.error}
      </div>
    )
  } else if (selectedAttempt || clientContent) {
    state = (
      <div className="flex h-full min-h-0 flex-col">
        <div className="sticky top-0 z-10 bg-card/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden />
              <Input
                aria-label="搜索请求详情内容"
                value={search}
                onChange={event => setSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  jumpToMatch(event.shiftKey ? -1 : 1)
                }}
                placeholder="搜索内容（Enter 定位下一处）"
                className="pl-9"
              />
            </div>
            {searchQuery && (
              <span
                aria-live="polite"
                className="shrink-0 font-mono system-2xs-regular tabular-nums text-text-tertiary"
              >
                {totalMatches === 0 ? '无匹配' : `${activeMatchIndex + 1}/${totalMatches}`}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="上一个匹配"
              title="上一个匹配（Shift+Enter）"
              disabled={totalMatches === 0}
              onClick={() => jumpToMatch(-1)}
            >
              <ChevronUp size={14} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="下一个匹配"
              title="下一个匹配（Enter）"
              disabled={totalMatches === 0}
              onClick={() => jumpToMatch(1)}
            >
              <ChevronDown size={14} />
            </Button>
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
        <div ref={contentRef} className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 pt-3">
          {selectedAttempt && <AttemptError attempt={selectedAttempt} />}
          {selectedAttempt && <AttemptFacts attempt={selectedAttempt} />}
          <AppliedRules ruleIds={selectedAttempt ? [...selectedAttempt.requestRewriteRuleIds, ...selectedAttempt.responseRewriteRuleIds] : []} rules={props.requestRewriteRules} />
          {searchQuery && totalMatches === 0 && (
            <div className="rounded-md border border-module-border bg-inset px-3 py-2 system-xs-regular text-text-tertiary">
              没有匹配「{searchQuery}」的内容
            </div>
          )}
          {stages.map(stage => (
            <RequestStage
              key={stage.title}
              {...stage}
              sectionStates={sectionStates}
              onSectionOpenChange={(id, open) => setSectionStates(current => ({ ...current, [id]: open }))}
              search={searchResult}
              activeMatchIndex={searchQuery && totalMatches > 0 ? activeMatchIndex : null}
            />
          ))}
        </div>
      </div>
    )
  } else if (props.selectedAttemptId) {
    state = <div className="py-8 text-center system-xs-regular text-text-tertiary">该尝试没有可查看的记录</div>
  } else {
    state = null
  }

  return (
    <Sheet open={Boolean(props.selectedAttemptId)} onOpenChange={open => !open && props.onClose()}>
      <SheetContent side="right" className="flex h-full w-full max-w-3xl! flex-col gap-0 border-0 bg-card p-0 shadow-none" onOpenAutoFocus={event => event.preventDefault()}>
        <SheetHeader className="shrink-0 border-b border-border/50 px-4 py-3.5 pr-12">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span>{selectedAttempt ? `尝试 ${selectedAttempt.attemptIndex + 1} / ${props.attempts.length}` : '请求详情'}</span>
            {/* 结果就是 HTTP 状态，与列表行用同一套徽标，Sheet 里不再另说一遍。 */}
            {selectedAttempt && (
              <span className={cn(
                'rounded-sm px-1.5 py-0.5 font-mono system-2xs-medium',
                selectedAttempt.status === 'success'
                  ? 'bg-success/10 text-text-success'
                  : 'bg-destructive/10 text-text-destructive',
              )}>
                {formatAttemptOutcome(selectedAttempt)}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            {selectedAttempt
              ? `${selectedAttempt.providerName} / ${selectedAttempt.providerModelName}`
              : '按请求链路和采集时的原始字符串展示'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-hidden">{state}</div>
      </SheetContent>
    </Sheet>
  )
}
