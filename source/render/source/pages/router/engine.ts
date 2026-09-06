import type {
  ConditionCase,
  ConditionOperator,
  ConditionRule,
  ControlInputNode,
  QueueRouteRule,
  QueueSelection,
  QueueSelectNode,
  ProtocolDiscoveryNode,
  RouteContext,
  RouteContextEnvelope,
  RouteContextInput,
  WorkflowGraph,
  WorkflowProtocol,
  WorkflowRunResult,
  WorkflowTrace,
} from './types'

export interface WorkflowRunOptions {}

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
    if (Array.isArray(actual)) {
      return actual.map(item => String(item)).includes(rule.value ?? '')
    }
    return String(actual ?? '').includes(rule.value ?? '')
  }

  if (operator === 'notContains') {
    if (Array.isArray(actual)) {
      return !actual.map(item => String(item)).includes(rule.value ?? '')
    }
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

function normalizeProtocolMessageContent(content: unknown): unknown {
  if (Array.isArray(content)) {
    return content.map(item => typeof item === 'string' ? item : (item && typeof item === 'object' ? item : String(item ?? '')))
  }
  if (content === undefined || content === null) return ''
  if (typeof content === 'string' || typeof content === 'number' || typeof content === 'boolean') return content
  return JSON.stringify(content)
}

function normalizeProtocolMessages(candidate: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(candidate)) return []

  return candidate.map((item) => {
    if (!item || typeof item !== 'object') {
      return { role: 'user', content: String(item ?? '') }
    }

    const record = item as Record<string, unknown>
    const role = typeof record.role === 'string' ? record.role : 'user'
    const content = 'content' in record ? record.content : ('text' in record ? record.text : '')

    return {
      ...record,
      role,
      content: normalizeProtocolMessageContent(content),
    }
  })
}

function buildNormalizedProtocolOutput(protocol: WorkflowProtocol, payload: Record<string, unknown>): Record<string, unknown> {
  const requestBody = (getByPath(payload, 'request.body') ?? {}) as Record<string, unknown>
  const model = typeof requestBody.model === 'string' ? requestBody.model : ''
  const bodyMessages = Array.isArray(requestBody.messages)
    ? requestBody.messages
    : Array.isArray(requestBody.input)
      ? requestBody.input
      : []

  return {
    protocol,
    model,
    messages: normalizeProtocolMessages(bodyMessages),
    raw: requestBody,
  }
}

function recordProtocolOutput(payload: Record<string, unknown>, protocol: WorkflowProtocol): Record<string, unknown> {
  const metadata = (payload.metadata && typeof payload.metadata === 'object'
    ? payload.metadata
    : {}) as Record<string, unknown>
  const normalized = buildNormalizedProtocolOutput(protocol, payload)
  const branchOutputs = (metadata.protocolOutputs && typeof metadata.protocolOutputs === 'object'
    ? metadata.protocolOutputs
    : {}) as Record<string, unknown>

  branchOutputs[protocol] = normalized
  metadata.protocol = protocol
  metadata.protocolOutput = normalized
  metadata.protocolOutputs = branchOutputs
  payload.metadata = metadata

  return normalized
}

function normalizeQueueIds(queueIds: string[]): string[] {
  return [...new Set(queueIds.map(id => id.trim()).filter(Boolean))]
}

function controlBoolean(payload: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = getByPath(payload, `metadata.controls.${key}`)
  return typeof raw === 'boolean' ? raw : fallback
}

function controlString(payload: Record<string, unknown>, key: string): string | undefined {
  const raw = getByPath(payload, `metadata.controls.${key}`)
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

function evaluateRuleSpecificity(rule: QueueRouteRule): number {
  if (rule.operator === 'equals' || rule.operator === 'in') return 400
  if (rule.operator === 'startsWith' || rule.operator === 'endsWith') return 320
  if (rule.operator === 'contains' || rule.operator === 'notContains') return 220
  if (rule.operator === 'regex') return 120
  return 180
}

function selectQueues(node: QueueSelectNode, payload: Record<string, unknown>): QueueSelection {
  const fallbackQueueId = controlString(payload, 'defaultQueueId')
    ?? (node.fallbackQueueId?.trim() || undefined)
    ?? node.queueIds.map(id => id.trim()).find(Boolean)
    ?? 'default'

  if (node.mode !== 'rule-based') {
    const staticQueueIds = normalizeQueueIds(node.queueIds)
    if (staticQueueIds.length > 0) {
      return { queueIds: staticQueueIds, reason: `静态选择 ${staticQueueIds.length} 个逻辑队列` }
    }
    return { queueIds: [fallbackQueueId], reason: `静态队列为空，回退到默认队列 ${fallbackQueueId}` }
  }

  const enableModelRouting = controlBoolean(payload, 'enableModelRouting', true)
  const enableHeaderRouting = controlBoolean(payload, 'enableHeaderRouting', true)
  const requestModel = String(getByPath(payload, 'request.body.model') ?? '').trim()

  if (enableModelRouting && requestModel && node.modelQueueRoutes?.length) {
    const hit = node.modelQueueRoutes.find(route => route.enabled && route.modelId.trim().toLowerCase() === requestModel.toLowerCase())
    if (hit) {
      const queueIds = normalizeQueueIds(hit.queueIds)
      if (queueIds.length > 0) {
        return { queueIds, reason: `模型直达命中 ${hit.modelId}` }
      }
    }
  }

  const matched = (node.rules ?? [])
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => {
      if (!rule.enabled) return false
      if (rule.scope === 'model' && !enableModelRouting) return false
      if (rule.scope === 'header' && !enableHeaderRouting) return false
      return true
    })
    .filter(({ rule }) => {
      const actual = getByPath(payload, rule.fieldPath)
      return evaluateCondition(rule, actual)
    })
    .map(({ rule, index }) => ({
      rule,
      index,
      specificity: evaluateRuleSpecificity(rule),
      queueIds: normalizeQueueIds(rule.queueIds),
    }))
    .filter(item => item.queueIds.length > 0)

  if (matched.length > 0) {
    matched.sort((a, b) => {
      if (node.conflictStrategy === 'highest-priority') {
        if (a.rule.priority !== b.rule.priority) return a.rule.priority - b.rule.priority
        if (a.specificity !== b.specificity) return b.specificity - a.specificity
      } else {
        if (a.specificity !== b.specificity) return b.specificity - a.specificity
        if (a.rule.priority !== b.rule.priority) return a.rule.priority - b.rule.priority
      }
      return a.index - b.index
    })

    const winner = matched[0]
    return {
      queueIds: winner?.queueIds ?? [fallbackQueueId],
      reason: winner ? `规则命中 ${winner.rule.name}` : `回退到默认队列 ${fallbackQueueId}`,
    }
  }

  return { queueIds: [fallbackQueueId], reason: `未命中规则，回退到默认队列 ${fallbackQueueId}` }
}

function buildMissingInputTrace(message: string): WorkflowTrace {
  return { nodeId: '-', nodeName: '初始化', kind: 'input', success: false, message }
}

function edgeTarget(edges: Map<string, string>, nodeId: string, port = 'out'): string | undefined {
  return edges.get(`${nodeId}:${port}`)
}

export function runWorkflow(graph: WorkflowGraph, inputPayload: unknown, _options: WorkflowRunOptions = {}): WorkflowRunResult {
  const envelope = normalizeInputPayload(inputPayload)
  const outputPayload = envelope.payload
  const trace: WorkflowTrace[] = []
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const edges = new Map<string, string>()
  for (const edge of graph.edges) edges.set(`${edge.sourceNodeId}:${edge.sourcePort}`, edge.targetNodeId)
  let protocol: WorkflowProtocol = 'unknown'
  const queueSelections: Record<string, QueueSelection> = {}
  let steps = 0
  let stopReason: WorkflowRunResult['stopReason'] = 'missing-next'

  const execute = (startId: string | undefined, stopAt?: string): string | undefined => {
    let currentId = startId
    while (currentId && steps < MAX_STEPS) {
      if (currentId === stopAt) return currentId
      const current = byId.get(currentId)
      if (!current) { stopReason = 'missing-next'; return undefined }
      steps += 1

      if (!current.enabled && current.kind !== 'input' && current.kind !== 'output') {
        trace.push({ nodeId: current.id, nodeName: current.name, kind: current.kind, success: true, message: '节点禁用，跳过' })
        currentId = edgeTarget(edges, current.id, current.kind === 'protocol-discovery' ? 'unknown' : 'out')
        continue
      }

      if (current.kind === 'input') {
        trace.push({ nodeId: current.id, nodeName: current.name, kind: current.kind, success: true, message: '输入进入路由流程' })
        currentId = edgeTarget(edges, current.id)
        continue
      }

      if (current.kind === 'control-input') {
        applyControlInputs(outputPayload, current)
        trace.push({
          nodeId: current.id, nodeName: current.name, kind: current.kind, success: true,
          message: '控制输入已写入 metadata.controls',
          details: { controls: current.controls.filter(control => control.enabled).map(control => ({ key: control.key, kind: control.kind, value: control.defaultValue })) },
        })
        currentId = edgeTarget(edges, current.id)
        continue
      }

      if (current.kind === 'protocol-discovery') {
        const discovered = discoverProtocol(current, outputPayload)
        protocol = discovered.protocol
        const normalized = recordProtocolOutput(outputPayload, protocol)
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: protocol !== 'unknown',
          message: discovered.reason,
          details: { protocol, normalized },
        })
        currentId = edgeTarget(edges, current.id, protocol)
        continue
      }

      if (current.kind === 'condition') {
        const caseResults = current.cases.map(caseNode => ({ caseId: caseNode.id, name: caseNode.name, passed: evaluateCase(caseNode, outputPayload) }))
        const matchedCase = current.cases.find((_case, index) => caseResults[index]?.passed)
        const port = matchedCase?.id ?? 'else'
        currentId = edgeTarget(edges, current.id, port)
        trace.push({
          nodeId: current.id, nodeName: current.name, kind: current.kind, success: Boolean(matchedCase),
          message: matchedCase ? `命中分支 ${matchedCase.name}` : '未命中任何分支，走 ELSE',
          details: { cases: caseResults, matchedCaseId: matchedCase?.id ?? null, sourcePort: port },
        })
        continue
      }

      if (current.kind === 'queue-select') {
        const selection = selectQueues(current, outputPayload)
        queueSelections[current.id] = selection
        outputPayload.queueIds = selection.queueIds
        trace.push({ nodeId: current.id, nodeName: current.name, kind: current.kind, success: selection.queueIds.length > 0, message: selection.reason, details: { queueIds: selection.queueIds, reason: selection.reason } })
        currentId = edgeTarget(edges, current.id)
        continue
      }

      if (current.kind === 'output') {
        trace.push({ nodeId: current.id, nodeName: current.name, kind: current.kind, success: true, message: '到达输出节点', details: { includeTrace: current.includeTrace, summaryLevel: current.summaryLevel } })
        stopReason = 'output'
        return undefined
      }
    }
    if (steps >= MAX_STEPS) stopReason = 'max-steps'
    return currentId
  }

  const start = graph.nodes.find(node => node.kind === 'input')
  if (!start) return { outputPayload, protocol: 'unknown', queueSelections: {}, stopReason: 'error', trace: [buildMissingInputTrace('缺少输入节点')] }
  execute(start.id)
  return { outputPayload, protocol, queueSelections, stopReason, trace }
}

export function createRouteContextInput(payload: RouteContextInput): RouteContextEnvelope {
  return normalizeInputPayload(payload)
}
