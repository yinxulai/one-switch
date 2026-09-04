import type {
  ConditionCase,
  ConditionOperator,
  ConditionRule,
  ControlInputNode,
  ResolverDecision,
  ResolverNode,
  RuntimeCandidate,
  ProtocolDiscoveryNode,
  RouteContext,
  RouteContextEnvelope,
  RouteContextInput,
  WorkflowProtocol,
  WorkflowNodeModel,
  WorkflowRunResult,
  WorkflowTrace,
  RuntimeLogicalModel,
} from './types'

export interface WorkflowRunOptions {
  logicalModels?: RuntimeLogicalModel[]
  catalogs?: Record<string, RuntimeCandidate[]>
}

const MAX_STEPS = 80

function generateTraceId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `trace-${Date.now()}-${random}`
}

function clonePayload<T>(payload: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload)
  }
  return JSON.parse(JSON.stringify(payload)) as T
}

function parsePath(path: string): string[] {
  return path
    .split('.')
    .map(segment => segment.trim())
    .filter(Boolean)
}

function getByPath(payload: unknown, path: string): unknown {
  const segments = parsePath(path)
  if (!segments.length) return undefined
  let current: unknown = payload

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

function normalizeInputPayload(inputPayload: unknown): RouteContextEnvelope {
  const normalized = (inputPayload && typeof inputPayload === 'object' ? clonePayload(inputPayload) : {}) as Record<string, unknown>

  const request = (normalized.request && typeof normalized.request === 'object'
    ? normalized.request
    : {}) as Record<string, unknown>

  const metadata = (normalized.metadata && typeof normalized.metadata === 'object'
    ? normalized.metadata
    : {}) as Record<string, unknown>

  const context: RouteContext = {
    request,
    metadata,
    traceId: typeof metadata.traceId === 'string' && metadata.traceId.trim() ? metadata.traceId : generateTraceId(),
  }

  normalized.request = request
  normalized.metadata = { ...metadata, traceId: context.traceId }

  return {
    payload: normalized,
    context,
  }
}

function applyControlInputs(payload: Record<string, unknown>, node: ControlInputNode): void {
  const metadata = (payload.metadata && typeof payload.metadata === 'object'
    ? payload.metadata
    : {}) as Record<string, unknown>
  const controls = (metadata.controls && typeof metadata.controls === 'object'
    ? metadata.controls
    : {}) as Record<string, unknown>

  for (const control of node.controls) {
    if (!control.enabled) continue
    controls[control.key] = control.defaultValue
  }

  metadata.controls = controls
  payload.metadata = metadata
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function splitSet(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function evaluateCondition(rule: ConditionRule, actual: unknown): boolean {
  const operator: ConditionOperator = rule.operator

  if (operator === 'exists') {
    return actual !== undefined && actual !== null
  }

  if (operator === 'empty') {
    return actual === undefined || actual === null || String(actual).trim() === ''
  }

  if (operator === 'notEmpty') {
    return actual !== undefined && actual !== null && String(actual).trim() !== ''
  }

  if (operator === 'isTrue') {
    return actual === true
  }

  if (operator === 'isFalse') {
    return actual === false
  }

  if (operator === 'regex') {
    try {
      return new RegExp(rule.value ?? '').test(String(actual ?? ''))
    } catch {
      return false
    }
  }

  if (operator === 'contains') {
    return String(actual ?? '').includes(rule.value ?? '')
  }

  if (operator === 'notContains') {
    return !String(actual ?? '').includes(rule.value ?? '')
  }

  if (operator === 'startsWith') {
    return String(actual ?? '').startsWith(rule.value ?? '')
  }

  if (operator === 'endsWith') {
    return String(actual ?? '').endsWith(rule.value ?? '')
  }

  if (operator === 'in' || operator === 'notIn') {
    const items = rule.valueType === 'enum' && rule.enumOptions?.length
      ? rule.enumOptions
      : splitSet(rule.value)
    const included = items.includes(String(actual ?? ''))
    return operator === 'in' ? included : !included
  }

  if (operator === 'between') {
    const lower = parseNumber(rule.value)
    const upper = parseNumber(rule.secondaryValue)
    const current = Number(actual)
    if (!Number.isFinite(current) || lower === null || upper === null) {
      return false
    }
    return current >= lower && current <= upper
  }

  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    const current = Number(actual)
    const expected = parseNumber(rule.value)
    if (!Number.isFinite(current) || expected === null) {
      return false
    }

    if (operator === 'gt') return current > expected
    if (operator === 'gte') return current >= expected
    if (operator === 'lt') return current < expected
    return current <= expected
  }

  const left = String(actual ?? '')
  const right = String(rule.value ?? '')
  if (operator === 'equals') return left === right
  if (operator === 'notEquals') return left !== right
  return false
}

function evaluateCase(caseNode: ConditionCase, payload: Record<string, unknown>): boolean {
  const results = caseNode.conditions.map(rule => evaluateCondition(rule, getByPath(payload, rule.fieldPath)))
  return caseNode.logicalOperator === 'and'
    ? results.every(Boolean)
    : results.some(Boolean)
}

function discoverProtocol(_node: ProtocolDiscoveryNode, payload: Record<string, unknown>): { protocol: WorkflowProtocol; reason: string } {
  const path = String(getByPath(payload, 'request.path') ?? '').toLowerCase()
  const headersValue = getByPath(payload, 'request.headers')
  const headers = headersValue && typeof headersValue === 'object'
    ? (headersValue as Record<string, unknown>)
    : {}

  const providerHeader = String(headers['x-provider'] ?? headers['X-Provider'] ?? '').toLowerCase()
  const modelId = String(getByPath(payload, 'request.body.model') ?? '').toLowerCase()

  if (providerHeader.includes('openai') || path.includes('/chat/completions')) {
    return { protocol: 'openai-completions', reason: '根据 header/path 判定为 openai-completions' }
  }

  if (path.includes('/responses')) {
    return { protocol: 'openai-responses', reason: '根据 path 判定为 openai-responses' }
  }

  if (providerHeader.includes('anthropic') || path.includes('/messages') || modelId.includes('claude')) {
    return { protocol: 'anthropic-messages', reason: '根据 header/path/model 判定为 anthropic-messages' }
  }

  return { protocol: 'unknown', reason: '自动识别未命中，归类 unknown' }
}

function resolveCandidates(node: ResolverNode, catalogs: Record<string, RuntimeCandidate[]>): RuntimeCandidate[] {
  const candidates = node.resolution.candidates.source === 'catalog'
    ? catalogs[node.resolution.resource] ?? []
    : (catalogs[node.resolution.resource] ?? []).filter(candidate => node.resolution.candidates.ids?.includes(candidate.id))
  return candidates.filter(candidate => candidate.enabled !== false)
}

function resolveCandidate(node: ResolverNode, payload: Record<string, unknown>, catalogs: Record<string, RuntimeCandidate[]>): ResolverDecision {
  const input = String(getByPath(payload, node.input.path) ?? '').trim()
  const candidates = resolveCandidates(node, catalogs)
  const matched = node.resolution.match
    .map((rule, index) => ({ rule, index }))
    .flatMap(({ rule, index }) => candidates
      .filter(candidate => rule.operator === 'equalsInput' && (candidate.id === input || candidate.name === input))
      .map(candidate => ({ candidate, index })))
    [0]

  if (matched) {
    return {
      selectedId: matched.candidate.id,
      resource: node.resolution.resource,
      source: 'match',
      matchedRule: matched.index,
      reason: `输入 ${input || '(缺失)'} 命中 ${node.resolution.resource} ${matched.candidate.id}`,
    }
  }

  const fallback = node.resolution.fallback
  const fallbackCandidate = fallback && fallback.resource === node.resolution.resource
    ? candidates.find(candidate => candidate.id === fallback.id)
    : undefined
  return {
    selectedId: fallbackCandidate?.id ?? null,
    resource: node.resolution.resource,
    source: fallbackCandidate ? 'fallback' : 'none',
    reason: fallbackCandidate
      ? `输入 ${input || '(缺失)'} 未命中，回退到 ${fallbackCandidate.id}`
      : `输入 ${input || '(缺失)'} 未命中，且没有可用回退资源`,
  }
}

function nextForProtocol(node: ProtocolDiscoveryNode, protocol: WorkflowProtocol): string {
  return node.branches[protocol]
}

function readArrayItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isTerminal(node: WorkflowNodeModel): boolean {
  return node.kind === 'output'
}

function buildMissingInputTrace(message: string): WorkflowTrace {
  return {
    nodeId: '-',
    nodeName: '初始化',
    kind: 'input',
    success: false,
    message,
  }
}

export function runWorkflow(nodes: WorkflowNodeModel[], inputPayload: unknown, options: WorkflowRunOptions = {}): WorkflowRunResult {
  const envelope = normalizeInputPayload(inputPayload)
  const logicalModels = options.logicalModels ?? []
  const catalogs: Record<string, RuntimeCandidate[]> = {
    'logical-model': logicalModels,
    ...(options.catalogs ?? {}),
  }
  const outputPayload = envelope.payload
  const trace: WorkflowTrace[] = []
  const byId = new Map(nodes.map(node => [node.id, node]))
  const iterationStacks = new Map<string, { index: number; item: unknown }[]>()
  const loopCounters = new Map<string, number>()

  const start = nodes.find(node => node.kind === 'input')
  if (!start) {
    return {
      outputPayload,
      protocol: 'unknown',
      resolutions: {},
      stopReason: 'error',
      trace: [buildMissingInputTrace('缺少输入节点')],
    }
  }

  let current: WorkflowNodeModel | undefined = start
  let protocol: WorkflowProtocol = 'unknown'
  const resolutions: Record<string, ResolverDecision> = {}
  let stopReason: WorkflowRunResult['stopReason'] = 'missing-next'
  let steps = 0

  while (current && steps < MAX_STEPS) {
    steps += 1

    if (!current.enabled && current.kind !== 'input' && current.kind !== 'output') {
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: true,
        message: '节点禁用，跳过',
      })

      let disabledNext: string | null = null
      if (current.kind === 'control-input') {
        disabledNext = current.next
      } else if (current.kind === 'protocol-discovery') {
        disabledNext = current.branches.unknown
      } else if (current.kind === 'condition') {
        disabledNext = current.elseNext
      } else if (current.kind === 'resolver') {
        disabledNext = current.next
      } else if (current.kind === 'iteration' || current.kind === 'loop') {
        disabledNext = current.next
      }

      if (!disabledNext) {
        stopReason = 'missing-next'
        break
      }

      current = byId.get(disabledNext)
      if (!current) {
        stopReason = 'missing-next'
      }
      continue
    }

    if (current.kind === 'input') {
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: true,
        message: '输入进入路由流程',
      })
      current = byId.get(current.next)
      if (!current) {
        stopReason = 'missing-next'
      }
      continue
    }

    if (current.kind === 'control-input') {
      applyControlInputs(outputPayload, current)
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: true,
        message: '控制输入已写入 metadata.controls',
        details: {
          controls: current.controls.filter(control => control.enabled).map(control => ({
            key: control.key,
            kind: control.kind,
            value: control.defaultValue,
          })),
        },
      })
      current = byId.get(current.next)
      if (!current) {
        stopReason = 'missing-next'
      }
      continue
    }

    if (current.kind === 'protocol-discovery') {
      const discovered = discoverProtocol(current, outputPayload)
      protocol = discovered.protocol
      ;(outputPayload.metadata as Record<string, unknown>).protocol = protocol
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: protocol !== 'unknown',
        message: discovered.reason,
        details: { protocol },
      })

      const nextId = nextForProtocol(current, protocol)
      current = byId.get(nextId)
      if (!current) {
        stopReason = 'missing-next'
      }
      continue
    }

    if (current.kind === 'condition') {
      const caseResults = current.cases.map(caseNode => ({
        caseId: caseNode.id,
        name: caseNode.name,
        passed: evaluateCase(caseNode, outputPayload),
      }))
      const matchedCase = current.cases.find(caseNode => evaluateCase(caseNode, outputPayload))
      const nextId = matchedCase?.next ?? current.elseNext
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: Boolean(matchedCase),
        message: matchedCase
          ? `命中分支 ${matchedCase.name}，走 ${matchedCase.next}`
          : `未命中任何分支，走 ELSE -> ${current.elseNext}`,
        details: {
          cases: caseResults,
          matchedCaseId: matchedCase?.id ?? null,
        },
      })
      current = byId.get(nextId)
      if (!current) {
        stopReason = 'missing-next'
      }
      continue
    }

    if (current.kind === 'resolver') {
      const decision = resolveCandidate(current, outputPayload, catalogs)
      resolutions[current.id] = decision
      const metadata = outputPayload.metadata as Record<string, unknown>
      const metadataResolutions = (metadata.resolutions && typeof metadata.resolutions === 'object'
        ? metadata.resolutions
        : {}) as Record<string, unknown>
      metadataResolutions[current.id] = decision
      metadata.resolutions = metadataResolutions
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: Boolean(decision.selectedId),
        message: decision.reason,
        details: {
          selectedId: decision.selectedId,
          resource: decision.resource,
          source: decision.source,
          protocol,
        },
      })
      current = byId.get(current.next)
      if (!current) {
        stopReason = 'missing-next'
      }
      continue
    }

    if (current.kind === 'iteration') {
      const items = readArrayItems(getByPath(outputPayload, current.input.path))
      const stack = iterationStacks.get(current.id) ?? []
      if (items.length === 0) {
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: true,
          message: '迭代输入为空数组，跳过循环体',
          details: { path: current.input.path, index: stack.length },
        })
        current = byId.get(current.next)
      } else if (stack.length < items.length) {
        stack.push({ index: stack.length, item: items[stack.length] })
        iterationStacks.set(current.id, stack)
        const active = stack[stack.length - 1]!
        const metadata = outputPayload.metadata as Record<string, unknown>
        metadata.iteration = { current: active.item, index: active.index, length: items.length }
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: true,
          message: `迭代 ${active.index + 1}/${items.length}`,
          details: { index: active.index, item: active.item },
        })
        current = byId.get(current.bodyNext)
      } else {
        iterationStacks.delete(current.id)
        const metadata = outputPayload.metadata as Record<string, unknown>
        delete metadata.iteration
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: true,
          message: `迭代完成，共 ${items.length} 项`,
          details: { index: items.length, length: items.length },
        })
        current = byId.get(current.next)
      }
      if (!current) stopReason = 'missing-next'
      continue
    }

    if (current.kind === 'loop') {
      const metadata = outputPayload.metadata as Record<string, unknown>
      const counter = loopCounters.get(current.id) ?? 0
      const conditionPassed = evaluateCondition(current.condition, getByPath(outputPayload, current.condition.fieldPath))
      const exhausted = counter >= current.maxIterations

      if (conditionPassed && !exhausted) {
        loopCounters.set(current.id, counter + 1)
        metadata.loop = { index: counter + 1, maxIterations: current.maxIterations }
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: true,
          message: `循环第 ${counter + 1}/${current.maxIterations} 轮（条件满足）`,
          details: { index: counter + 1, fieldPath: current.condition.fieldPath },
        })
        current = byId.get(current.bodyNext)
      } else {
        loopCounters.delete(current.id)
        delete metadata.loop
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: true,
          message: exhausted ? `达到最大迭代次数 ${current.maxIterations}，退出循环` : '循环条件不满足，退出循环',
          details: { index: counter, exhausted, fieldPath: current.condition.fieldPath },
        })
        current = byId.get(current.next)
      }
      if (!current) stopReason = 'missing-next'
      continue
    }

    if (isTerminal(current)) {
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: true,
        message: '到达输出节点',
        details: {
          includeTrace: current.includeTrace,
          summaryLevel: current.summaryLevel,
        },
      })
      stopReason = 'output'
      current = undefined
      continue
    }
  }

  if (steps >= MAX_STEPS) {
    stopReason = 'max-steps'
  }

  return {
    outputPayload,
    protocol,
    resolutions,
    stopReason,
    trace,
  }
}

export function createRouteContextInput(payload: RouteContextInput): RouteContextEnvelope {
  return normalizeInputPayload(payload)
}
