import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Circle,
  Cpu,
  FlaskConical,
  Gauge,
  Loader2,
  Play,
  Repeat,
  RotateCcw,
  Search,
  Square,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import type { Protocol, Provider, ProviderModelRoute } from '@common/schemas'
import { CONVERTIBLE_PROTOCOLS } from '@common/protocols'
import { modelTestApi, type ModelTestResult } from '@/api/tools'
import { InlineEmptyState } from '@/components/inline-empty-state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ModelTestPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  models: ProviderModelRoute[]
  providers: Provider[]
}

type TestTaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

interface TestTask {
  id: string
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  protocol: Protocol
  converted: boolean
  status: TestTaskStatus
  result?: ModelTestResult
  errorMessage?: string
}

const PROTOCOL_LABELS: Record<Protocol, string> = {
  'openai-completions': 'Chat Completions',
  'openai-responses': 'Responses',
  'anthropic-messages': 'Messages',
}

const TEST_CONCURRENCY = 3

const TASK_STATUS_LABELS: Record<TestTaskStatus, string> = {
  queued: '等待',
  running: '请求中',
  success: '通过',
  failed: '失败',
  cancelled: '已取消',
}

function getTestableProtocols(model: ProviderModelRoute): Protocol[] {
  const protocols = new Set(model.endpoints.map(endpoint => endpoint.protocol))
  for (const endpoint of model.endpoints) {
    if (!endpoint.protocolConversionEnabled) continue
    for (const protocol of CONVERTIBLE_PROTOCOLS[endpoint.protocol]) protocols.add(protocol)
  }
  return [...protocols]
}

function supportsConvertedProtocol(model: ProviderModelRoute, protocol: Protocol): boolean {
  return !model.endpoints.some(endpoint => endpoint.protocol === protocol)
    && model.endpoints.some(endpoint => endpoint.protocolConversionEnabled && CONVERTIBLE_PROTOCOLS[endpoint.protocol].includes(protocol))
}

interface ProtocolButtonState {
  converted: boolean
  selected: boolean
}

interface ProtocolButtonLabelOptions {
  converted: boolean
  protocol: Protocol
}

function getProtocolButtonClassName(state: ProtocolButtonState): string {
  if (state.converted) {
    return state.selected
      ? 'bg-warning/15 text-text-warning'
      : 'bg-inset text-text-tertiary hover:bg-warning/10 hover:text-text-primary'
  }
  if (state.selected) return 'bg-primary text-primary-foreground'
  return 'bg-inset text-text-tertiary hover:bg-state-base-hover hover:text-text-primary'
}

function getProtocolButtonLabel(options: ProtocolButtonLabelOptions): string {
  return PROTOCOL_LABELS[options.protocol]
}

function getProtocolButtonTitle(options: ProtocolButtonLabelOptions): string {
  const label = PROTOCOL_LABELS[options.protocol]
  return options.converted ? `${label}（经协议转换支持）` : label
}

function getTaskResponseSummary(task: TestTask): string {
  const status = task.result?.statusCode ? `HTTP ${task.result.statusCode} · ` : ''
  const duration = task.result ? `${task.result.durationMilliseconds}ms` : '—'
  return `${status}${duration}`
}

interface TaskStatusProps {
  status: TestTaskStatus
}

function TaskStatus(props: TaskStatusProps) {
  const { status } = props
  if (status === 'running') return <Loader2 size={15} aria-hidden className="animate-spin text-primary" />
  if (status === 'success') return <CheckCircle2 size={15} aria-hidden className="text-text-success" />
  if (status === 'failed') return <XCircle size={15} aria-hidden className="text-text-destructive" />
  if (status === 'cancelled') return <Square size={13} aria-hidden className="text-text-quaternary" />
  return <Circle size={15} aria-hidden className="text-text-quaternary" />
}

interface ModelSelectionProps {
  allTasksSelected: boolean
  availableProviders: Provider[]
  enabledModels: ProviderModelRoute[]
  running: boolean
  selectedModelProtocols: Record<string, Set<Protocol>>
  selectedProviderIds: Set<string>
  onToggleAll: () => void
  onToggleModelProtocol: (modelId: string, protocol: Protocol) => void
  onToggleProvider: (providerId: string) => void
}

function ModelSelection(props: ModelSelectionProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const providerViews = useMemo(() => props.availableProviders.map(provider => {
    const selected = props.selectedProviderIds.has(provider.id)
    const models = props.enabledModels
      .filter(model => model.providerId === provider.id)
      .filter(model => !normalizedQuery
        || provider.name.toLocaleLowerCase().includes(normalizedQuery)
        || model.modelName.toLocaleLowerCase().includes(normalizedQuery))
      .map(model => {
        const protocols = getTestableProtocols(model)
        const selectedProtocols = props.selectedModelProtocols[model.id] ?? new Set(protocols)
        return {
          model,
          selectedCount: selectedProtocols.size,
          protocols: protocols.map(protocol => {
            const converted = supportsConvertedProtocol(model, protocol)
            const protocolSelected = selectedProtocols.has(protocol)
            return {
              protocol,
              converted,
              selected: protocolSelected,
              label: getProtocolButtonLabel({ converted, protocol }),
              title: getProtocolButtonTitle({ converted, protocol }),
              className: getProtocolButtonClassName({ converted, selected: protocolSelected }),
            }
          }),
        }
      })
    return {
      provider,
      selected,
      models,
      selectedCount: models.filter(model => model.selectedCount > 0).length,
    }
  }).filter(view => view.models.length > 0), [normalizedQuery, props.availableProviders, props.enabledModels, props.selectedModelProtocols, props.selectedProviderIds])

  return (
    <aside className="flex min-h-0 flex-col bg-inset">
      <div className="grid gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="system-xs-medium text-text-primary">诊断范围</div>
            <div className="mt-1 system-2xs-regular text-text-tertiary">选择渠道后可细化到目标协议</div>
          </div>
          <Button variant="ghost" size="xs" disabled={props.running || props.enabledModels.length === 0} onClick={props.onToggleAll}>
            {props.allTasksSelected ? '清空' : '全选'}
          </Button>
        </div>
        <label className="flex h-8 items-center gap-2 rounded-lg bg-components-input-bg-normal px-3 text-text-quaternary transition-colors focus-within:bg-components-input-bg-active focus-within:ring-2 focus-within:ring-state-accent-solid">
          <Search size={13} aria-hidden />
          <input
            value={query}
            disabled={props.running}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索渠道或模型"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-components-input-text-filled outline-none placeholder:text-components-input-text-placeholder"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 grid gap-2 overflow-y-auto px-3 pb-3">
        {providerViews.map(providerView => (
          <section key={providerView.provider.id} className={cn('rounded-lg border border-transparent p-2.5 transition-colors hover:bg-state-base-hover', providerView.selected && 'border-module-border bg-card hover:bg-card')}>
            <button
              type="button"
              disabled={props.running}
              className="flex w-full items-center gap-2 text-left disabled:cursor-not-allowed"
              onClick={() => props.onToggleProvider(providerView.provider.id)}
            >
              <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-md bg-card text-text-quaternary', providerView.selected && 'bg-primary text-primary-foreground')}>
                {providerView.selected && <Check size={10} strokeWidth={3} aria-hidden />}
              </span>
              <span className="min-w-0 flex-1 truncate system-xs-medium text-text-primary">{providerView.provider.name}</span>
              <span className="font-mono system-2xs-regular tabular-nums text-text-quaternary">{providerView.models.length} 模型</span>
            </button>

            {providerView.selected && (
              <div className="mt-2.5 grid gap-2 pl-6">
                {providerView.models.map(modelView => (
                  <div key={modelView.model.id}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono system-2xs-regular text-text-secondary">{modelView.model.modelName}</span>
                      <span className="shrink-0 system-2xs-regular tabular-nums text-text-quaternary">{modelView.selectedCount}/{modelView.protocols.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {modelView.protocols.map(protocolView => (
                        <button
                          key={`${modelView.model.id}:${protocolView.protocol}`}
                          type="button"
                          disabled={props.running}
                          aria-pressed={protocolView.selected}
                          title={protocolView.title}
                          className={cn('inline-flex h-6 items-center gap-1 rounded-md px-1.5 system-2xs-medium transition-colors disabled:cursor-not-allowed', protocolView.className)}
                          onClick={() => props.onToggleModelProtocol(modelView.model.id, protocolView.protocol)}
                        >
                          {protocolView.converted && <Repeat size={9} aria-hidden />}
                          {protocolView.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
        {providerViews.length === 0 && (
          <InlineEmptyState title="没有匹配的渠道或模型" className="px-3 py-10" />
        )}
      </div>
    </aside>
  )
}

interface TestProgressProps {
  cancelledCount: number
  failureCount: number
  progress: number
  running: boolean
  successCount: number
}

interface TestTaskRowProps {
  task: TestTask
}

interface EmptyTestTasksProps {
  hasEnabledModels: boolean
}

function TestProgress(props: TestProgressProps) {
  const status = props.running
    ? '正在并发验证渠道'
    : props.failureCount > 0
      ? '诊断完成，发现异常'
      : props.cancelledCount > 0
        ? '诊断已停止'
        : '诊断完成，全部通过'
  return (
    <div className="bg-inset px-4 py-3">
      <div className="flex items-center justify-between gap-4 system-2xs-regular">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate system-2xs-medium text-text-primary">{status}</span>
          <span className="shrink-0 text-text-success">通过 {props.successCount}</span>
          <span className={cn('shrink-0', props.failureCount > 0 ? 'text-text-destructive' : 'text-text-tertiary')}>失败 {props.failureCount}</span>
          {props.cancelledCount > 0 && <span className="shrink-0 text-text-tertiary">取消 {props.cancelledCount}</span>}
        </div>
        <span className="shrink-0 font-mono tabular-nums text-text-tertiary">{props.progress}%</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-card"><div className={cn('h-full transition-all duration-300', props.failureCount > 0 && !props.running ? 'bg-destructive' : 'bg-primary')} style={{ width: `${props.progress}%` }} /></div>
    </div>
  )
}

function TestTaskRow(props: TestTaskRowProps) {
  const { task } = props
  const responseSummary = getTaskResponseSummary(task)
  return (
    <div className="grid gap-2 px-3 py-2.5 odd:bg-inset md:grid-cols-[24px_minmax(180px,1.5fr)_minmax(120px,1fr)_72px_120px] md:items-center md:gap-3">
      <TaskStatus status={task.status} />
      <div className="min-w-0">
        <div className="truncate system-xs-medium text-text-primary">{task.providerName}</div>
        <div className="mt-0.5 truncate font-mono system-2xs-regular text-text-tertiary">{task.modelName}</div>
      </div>
      <div className="min-w-0 system-2xs-regular text-text-tertiary">
        <span className={cn('inline-flex items-center gap-1 truncate', task.converted && 'text-text-warning')}>
          {task.converted && <Repeat size={9} aria-hidden />}{PROTOCOL_LABELS[task.protocol]}
        </span>
      </div>
      <div className={cn('system-2xs-medium', task.status === 'success' && 'text-text-success', task.status === 'failed' && 'text-text-destructive', task.status === 'running' && 'text-text-primary', task.status === 'cancelled' && 'text-text-tertiary')}>{TASK_STATUS_LABELS[task.status]}</div>
      <div className="font-mono system-2xs-regular tabular-nums text-text-tertiary md:text-right">{responseSummary}{task.result?.success && <span className="ml-1">↓{task.result.outputTokens ?? '—'}</span>}</div>
      {task.errorMessage && <div className="col-span-full ml-9 wrap-break-word rounded-lg bg-destructive/10 px-2.5 py-2 font-mono system-2xs-regular leading-4 text-text-destructive">{task.errorMessage}</div>}
    </div>
  )
}

function EmptyTestTasks(props: EmptyTestTasksProps) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-inset text-text-quaternary"><Cpu size={18} aria-hidden /></div>
      <div className="system-xs-medium text-text-primary">{props.hasEnabledModels ? '当前范围没有测试任务' : '没有可测试的供应商模型'}</div>
      <div className="mt-1.5 max-w-sm system-xs-regular leading-5 text-text-tertiary">
        {props.hasEnabledModels ? '在左侧列表中勾选需要测试的渠道和协议，结果会在这里展示。' : '请先在模型管理中添加并启用供应商模型，然后返回这里验证协议与渠道。'}
      </div>
    </div>
  )
}

export function ModelTestPanel(props: ModelTestPanelProps) {
  const enabledModels = useMemo(() => props.models.filter(model => model.enabled), [props.models])
  const availableProviders = useMemo(
    () => props.providers.filter(provider => enabledModels.some(model => model.providerId === provider.id)),
    [enabledModels, props.providers],
  )
  const [selectedModelProtocols, setSelectedModelProtocols] = useState<Record<string, Set<Protocol>>>({})
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set())
  const [tasks, setTasks] = useState<TestTask[]>([])
  const [running, setRunning] = useState(false)
  const previousOpen = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * 模型 / 供应商集合变化后校正选中态。
   *
   * 三个 updater 都遵守同一条规矩：**没有实际变化就返回 `current`**。
   * 否则这里每次都返回新对象 / 新 Set / 新数组，而 `enabledModels`、`availableProviders`
   * 又会随父级重渲染（供应商轮询每 10s、模型轮询每 30s）而重建，
   * 于是「重渲染 → 重跑 effect → 写新 state → 再重渲染」会一直空转。
   */
  useEffect(() => {
    const isOpening = props.open && !previousOpen.current
    previousOpen.current = props.open
    if (!props.open) return

    setSelectedModelProtocols(current => {
      if (isOpening) return Object.keys(current).length === 0 ? current : {}
      let changed = false
      const next: Record<string, Set<Protocol>> = {}
      for (const model of enabledModels) {
        const kept = new Set([...(current[model.id] ?? [])].filter(protocol => getTestableProtocols(model).includes(protocol)))
        const previous = current[model.id]
        // `kept` 是 `previous` 的子集，长度相同就意味着一个都没被剔掉，可以沿用原 Set 引用。
        if (previous && previous.size === kept.size) next[model.id] = previous
        else {
          next[model.id] = kept
          changed = true
        }
      }
      if (Object.keys(next).length !== Object.keys(current).length) changed = true
      return changed ? next : current
    })
    setSelectedProviderIds(current => {
      if (isOpening) return current.size === 0 ? current : new Set()
      const next = new Set([...current].filter(providerId => availableProviders.some(provider => provider.id === providerId)))
      return next.size === current.size ? current : next
    })
    if (isOpening) {
      setTasks(current => (current.length === 0 ? current : []))
      setRunning(false)
    }
  }, [props.open, enabledModels, availableProviders])

  const plannedTasks = useMemo<TestTask[]>(() => enabledModels.flatMap(model => {
    if (!selectedProviderIds.has(model.providerId)) return []
    const provider = props.providers.find(item => item.id === model.providerId)
    if (!provider) return []
    const selectedProtocols = selectedModelProtocols[model.id] ?? new Set(getTestableProtocols(model))
    return getTestableProtocols(model).filter(protocol => selectedProtocols.has(protocol)).map(protocol => ({
      id: `${model.id}:${protocol}`,
      modelId: model.id,
      modelName: model.modelName,
      providerId: provider.id,
      providerName: provider.name,
      protocol,
      converted: supportsConvertedProtocol(model, protocol),
      status: 'queued' as const,
    }))
  }), [enabledModels, props.providers, selectedModelProtocols, selectedProviderIds])

  const visibleTasks = tasks.length > 0 ? tasks : plannedTasks
  const completedCount = tasks.filter(task => task.status === 'success' || task.status === 'failed' || task.status === 'cancelled').length
  const successCount = tasks.filter(task => task.status === 'success').length
  const failureCount = tasks.filter(task => task.status === 'failed').length
  const cancelledCount = tasks.filter(task => task.status === 'cancelled').length
  const progress = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100)

  const clearTasks = () => setTasks([])
  const toggleModelProtocol = (modelId: string, protocol: Protocol) => {
    if (running) return
    setSelectedModelProtocols(current => {
      const next = { ...current }
      const selectedProtocols = new Set(current[modelId] ?? [])
      if (selectedProtocols.has(protocol)) selectedProtocols.delete(protocol)
      else selectedProtocols.add(protocol)
      next[modelId] = selectedProtocols
      return next
    })
    clearTasks()
  }

  const toggleProvider = (providerId: string) => {
    if (running) return
    setSelectedProviderIds(current => {
      const next = new Set(current)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
    clearTasks()
  }

  const allTasksSelected = enabledModels.length > 0
    && enabledModels.every(model => selectedProviderIds.has(model.providerId)
      && getTestableProtocols(model).every(protocol => selectedModelProtocols[model.id]?.has(protocol)))

  const toggleAll = () => {
    if (running) return
    if (allTasksSelected) {
      setSelectedProviderIds(new Set())
      setSelectedModelProtocols(Object.fromEntries(enabledModels.map(model => [model.id, new Set<Protocol>()])))
    } else {
      setSelectedProviderIds(new Set(availableProviders.map(provider => provider.id)))
      setSelectedModelProtocols(Object.fromEntries(
        enabledModels.map(model => [model.id, new Set(getTestableProtocols(model))]),
      ))
    }
    clearTasks()
  }

  const runTests = async () => {
    if (plannedTasks.length === 0 || running) return
    const pendingTasks = plannedTasks.map(task => ({ ...task }))
    const controller = new AbortController()
    abortControllerRef.current = controller
    setTasks(pendingTasks)
    setRunning(true)
    let nextIndex = 0

    const worker = async () => {
      while (!controller.signal.aborted && nextIndex < pendingTasks.length) {
        const task = pendingTasks[nextIndex++]
        setTasks(current => current.map(item => item.id === task.id ? { ...item, status: 'running' } : item))
        try {
          const response = await modelTestApi.run(task.protocol, {
            providerIds: [task.providerId],
            modelIds: [task.modelId],
          }, controller.signal)
          if (controller.signal.aborted) break
          const result = response.success
            ? response.data.results.find(item => item.modelId === task.modelId)
            : undefined
          const succeeded = Boolean(result?.success)
          setTasks(current => current.map(item => item.id === task.id ? {
            ...item,
            status: succeeded ? 'success' : 'failed',
            result,
            errorMessage: response.success ? result ? result.errorMessage : '未找到可测试的协议端点，请刷新模型配置后重试' : response.errorMessage,
          } : item))
        } catch (error) {
          if (controller.signal.aborted) break
          setTasks(current => current.map(item => item.id === task.id ? {
            ...item,
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : '诊断请求失败',
          } : item))
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(TEST_CONCURRENCY, pendingTasks.length) }, () => worker()))
    } finally {
      if (controller.signal.aborted) {
        setTasks(current => current.map(task => task.status === 'queued' || task.status === 'running'
          ? { ...task, status: 'cancelled', errorMessage: undefined }
          : task))
      }
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setRunning(false)
    }
  }

  const cancelTests = () => abortControllerRef.current?.abort()

  return (
    <Dialog open={props.open} onOpenChange={open => !running && props.onOpenChange(open)}>
      <DialogContent className="flex h-[min(780px,92vh)] w-[calc(100%-1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="bg-popover px-5 py-4 pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FlaskConical size={15} aria-hidden /></div>
            <div className="min-w-0">
              <DialogTitle>渠道诊断</DialogTitle>
              <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">验证上游连通性、模型可用性与协议转换链路</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
          <ModelSelection
            allTasksSelected={allTasksSelected}
            availableProviders={availableProviders}
            enabledModels={enabledModels}
            running={running}
            selectedModelProtocols={selectedModelProtocols}
            selectedProviderIds={selectedProviderIds}
            onToggleAll={toggleAll}
            onToggleModelProtocol={toggleModelProtocol}
            onToggleProvider={toggleProvider}
          />

          <div className="flex min-h-0 flex-col bg-card">
            <div className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Gauge size={14} aria-hidden className="text-text-quaternary" />
                    <div>
                      <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{plannedTasks.length}</div>
                      <div className="mt-1 system-2xs-regular text-text-tertiary">诊断任务</div>
                    </div>
                  </div>
                  <div className="h-7 w-px bg-border" />
                  <div>
                    <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{selectedProviderIds.size}</div>
                    <div className="mt-1 system-2xs-regular text-text-tertiary">已选渠道</div>
                  </div>
                  <div className="h-7 w-px bg-border" />
                  <div>
                    <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{TEST_CONCURRENCY}</div>
                    <div className="mt-1 system-2xs-regular text-text-tertiary">并发请求</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {tasks.length > 0 && !running && <Button variant="ghost" size="icon-sm" title="清除诊断结果" onClick={clearTasks}><RotateCcw size={13} /></Button>}
                  {running ? (
                    <Button variant="destructive" size="sm" onClick={cancelTests}>
                      <Square size={11} fill="currentColor" /> 停止
                    </Button>
                  ) : (
                    <Button size="sm" disabled={plannedTasks.length === 0} onClick={() => void runTests()}>
                      <Play size={12} fill="currentColor" /> 开始诊断
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {(running || tasks.length > 0) ? (
              <TestProgress
                cancelledCount={cancelledCount}
                failureCount={failureCount}
                progress={progress}
                running={running}
                successCount={successCount}
              />
            ) : (
              <div className="mx-4 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 system-2xs-regular leading-4 text-text-warning">
                <TriangleAlert size={13} aria-hidden className="shrink-0 text-text-warning" />
                将向每个目标发送一次最小真实请求，可能产生少量费用，并记录到请求日志。
              </div>
            )}

            <main className="min-h-0 flex-1 overflow-auto p-4">
              {visibleTasks.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-module-border bg-card">
                  <div className="hidden grid-cols-[24px_minmax(180px,1.5fr)_minmax(120px,1fr)_72px_120px] gap-3 bg-inset px-3 py-2 font-mono system-2xs-medium text-text-tertiary md:grid"><span /><span>渠道 / 模型</span><span>目标协议</span><span>状态</span><span className="text-right">响应</span></div>
                  {visibleTasks.map(task => <TestTaskRow key={task.id} task={task} />)}
                </div>
              ) : (
                <EmptyTestTasks hasEnabledModels={enabledModels.length > 0} />
              )}
            </main>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
