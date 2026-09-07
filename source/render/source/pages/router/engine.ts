import type {
  ConditionCase,
  ConditionOperator,
  ConditionRule,
  ControlInputNode,
  QueueSelection,
  QueueSelectNode,
  ProtocolDiscoveryNode,
  RouteContext,
  RouteContextEnvelope,
  RouteContextInput,
  WorkflowQueueContext,
  WorkflowRequestPayload,
  WorkflowGraph,
  WorkflowProtocol,
  WorkflowTransport,
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
    : {}) as WorkflowRequestPayload

  const metadata = (normalized.metadata && typeof normalized.metadata === 'object'
    ? normalized.metadata
    : {}) as Record<string, unknown>

  const queues = (Array.isArray(normalized.queues)
    ? normalized.queues.filter(item => item && typeof item === 'object').map(item => {
      const queue = item as Record<string, unknown>
      return {
        id: String(queue.id ?? '').trim(),
        name: String(queue.name ?? '').trim(),
        enabled: Boolean(queue.enabled),
      }
    }).filter(queue => queue.id && queue.name)
    : []) as WorkflowQueueContext[]

  const requestModelId = typeof request.body?.model === 'string' ? request.body.model.trim() : ''
  const queueIds = queues.map(queue => queue.id)
  const queueNames = queues.map(queue => queue.name)
  const modelInQueues = requestModelId ? queueIds.includes(requestModelId) : false

  const routerMetadata = {
    requestModelId,
    queueIds,
    queueNames,
    requestModelInQueues: modelInQueues,
  }

  metadata.router = {
    ...(metadata.router && typeof metadata.router === 'object' ? metadata.router as Record<string, unknown> : {}),
    ...routerMetadata,
  }

  const context: RouteContext = {
    request,
    queues,
    metadata,
    traceId: typeof metadata.traceId === 'string' && metadata.traceId.trim() ? metadata.traceId : generateTraceId(),
  }

  normalized.request = request
  normalized.queues = queues
  normalized.metadata = { ...metadata, traceId: context.traceId }

  return {
    payload: normalized,
    context,
  }
}

function normalizeHeaderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => String(item)).join(',')
  }
  if (typeof value === 'string') return value
  return ''
}

function getHeader(headers: Record<string, unknown>, name: string): string {
  const lowered = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowered) {
      return normalizeHeaderValue(value)
    }
  }
  return ''
}

function detectTransport(payload: Record<string, unknown>): WorkflowTransport {
  const headersValue = getByPath(payload, 'request.headers')
  const headers = headersValue && typeof headersValue === 'object'
    ? (headersValue as Record<string, unknown>)
    : {}

  const accept = getHeader(headers, 'accept').toLowerCase()
  const contentType = getHeader(headers, 'content-type').toLowerCase()
  const stream = getByPath(payload, 'request.body.stream')
  if (accept.includes('text/event-stream') || contentType.includes('text/event-stream') || stream === true) {
    return 'http-sse'
  }

  return 'http'
}

function resolveProtocolTarget(edges: Map<string, string>, nodeId: string, protocol: WorkflowProtocol): string | undefined {
  return edgeTarget(edges, nodeId, protocol)
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

function discoverProtocol(_node: ProtocolDiscoveryNode, payload: Record<string, unknown>): {
  protocol: WorkflowProtocol
  transport: WorkflowTransport
  reason: string
} {
  const path = String(getByPath(payload, 'request.path') ?? '').toLowerCase()
  const headersValue = getByPath(payload, 'request.headers')
  const headers = headersValue && typeof headersValue === 'object'
    ? (headersValue as Record<string, unknown>)
    : {}

  const providerHeader = getHeader(headers, 'x-provider').toLowerCase()
  const modelId = String(getByPath(payload, 'request.body.model') ?? '').toLowerCase()
  const transport = detectTransport(payload)

  if (providerHeader.includes('openai') || path.includes('/chat/completions')) {
    const protocol: WorkflowProtocol = 'openai-completions'
    return {
      protocol,
      transport,
      reason: `根据 header/path 判定为 openai-completions，传输 ${transport}`,
    }
  }

  if (path.includes('/responses')) {
    const protocol: WorkflowProtocol = 'openai-responses'
    return {
      protocol,
      transport,
      reason: `根据 path 判定为 openai-responses，传输 ${transport}`,
    }
  }

  if (providerHeader.includes('anthropic') || path.includes('/messages') || modelId.includes('claude')) {
    const protocol: WorkflowProtocol = 'anthropic-messages'
    return {
      protocol,
      transport,
      reason: `根据 header/path/model 判定为 anthropic-messages，传输 ${transport}`,
    }
  }

  return {
    protocol: 'unknown',
    transport,
    reason: `自动识别未命中，归类 unknown，传输 ${transport}`,
  }
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

function buildNormalizedProtocolOutput(protocol: WorkflowProtocol, transport: WorkflowTransport, payload: Record<string, unknown>): Record<string, unknown> {
  const requestBody = (getByPath(payload, 'request.body') ?? {}) as Record<string, unknown>
  const model = typeof requestBody.model === 'string' ? requestBody.model : ''
  const bodyMessages = Array.isArray(requestBody.messages)
    ? requestBody.messages
    : Array.isArray(requestBody.input)
      ? requestBody.input
      : []

  return {
    protocol,
    transport,
    model,
    messages: normalizeProtocolMessages(bodyMessages),
    raw: requestBody,
  }
}

function recordProtocolOutput(payload: Record<string, unknown>, protocol: WorkflowProtocol, transport: WorkflowTransport): Record<string, unknown> {
  const metadata = (payload.metadata && typeof payload.metadata === 'object'
    ? payload.metadata
    : {}) as Record<string, unknown>
  const normalized = buildNormalizedProtocolOutput(protocol, transport, payload)
  const branchOutputs = (metadata.protocolOutputs && typeof metadata.protocolOutputs === 'object'
    ? metadata.protocolOutputs
    : {}) as Record<string, unknown>

  branchOutputs[protocol] = normalized
  metadata.protocol = protocol
  metadata.transport = transport
  metadata.protocolOutput = normalized
  metadata.protocolOutputs = branchOutputs
  payload.metadata = metadata

  return normalized
}

function normalizeQueueIds(queueIds: string[]): string[] {
  return [...new Set(queueIds.map(id => id.trim()).filter(Boolean))]
}

function selectQueues(node: QueueSelectNode): QueueSelection {
  const queueIds = normalizeQueueIds(node.queueIds)
  return { queueIds, reason: `选择 ${queueIds.length} 个逻辑队列` }
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
        currentId = current.kind === 'protocol-discovery'
          ? resolveProtocolTarget(edges, current.id, 'unknown')
          : edgeTarget(edges, current.id, 'out')
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
        const normalized = recordProtocolOutput(outputPayload, protocol, discovered.transport)
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: protocol !== 'unknown',
          message: discovered.reason,
          details: {
            protocol,
            transport: discovered.transport,
            normalized,
          },
        })
        currentId = resolveProtocolTarget(edges, current.id, protocol)
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
        const selection = selectQueues(current)
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
