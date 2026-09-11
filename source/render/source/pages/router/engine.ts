import {
  type ConditionCase,
  type ConditionOperator,
  type ConditionRule,
  type ControlInputNode,
  type QueueSelection,
  type QueueSelectNode,
  type ProtocolDiscoveryNode,
  type RouteContext,
  type RouteContextEnvelope,
  type RouteContextInput,
  type RouteDecision,
  type WorkflowQueueContext,
  type WorkflowRequestPayload,
  type WorkflowGraph,
  type WorkflowProtocol,
  type WorkflowTransport,
  type WorkflowRunResult,
  type WorkflowTrace,
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

function createEmptyRoute(): RouteDecision {
  return {
    traceId: '',
    protocol: 'unknown',
    transport: 'http',
    queueIds: [],
    fallback: false,
    requestedModel: '',
    requestedModelInQueues: false,
    availableQueueIds: [],
    controls: {},
  }
}

/** 取对象字段；不存在或类型不对时原地建一个空对象。 */
function objectField(container: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = container[key]
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>
  }
  const created: Record<string, unknown> = {}
  container[key] = created
  return created
}

/** 读取 payload 上的 `route` 决策命名空间（由 `normalizeInputPayload` 建好）。 */
function routeOf(payload: Record<string, unknown>): RouteDecision {
  return objectField(payload, 'route') as unknown as RouteDecision
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

  const requestedModel = typeof request.body?.model === 'string' ? request.body.model.trim() : ''
  const availableQueueIds = queues.map(queue => queue.id)
  const traceId = typeof metadata.traceId === 'string' && metadata.traceId.trim() ? metadata.traceId : generateTraceId()

  /**
   * `metadata` 归调用方所有：引擎只读不写。
   * 路由自己产生的数据（决策 + 决策依据）统一写在 `route` 命名空间下，
   * 过程性数据（协议归一化结果、节点判定明细）只进 trace。
   */
  normalized.route = {
    ...createEmptyRoute(),
    traceId,
    transport: detectTransport(normalized),
    requestedModel,
    requestedModelInQueues: requestedModel ? availableQueueIds.includes(requestedModel) : false,
    availableQueueIds,
    controls: objectField(normalized, 'controls'),
  } satisfies RouteDecision

  const context: RouteContext = {
    request,
    queues,
    metadata,
    traceId,
  }

  normalized.request = request
  normalized.queues = queues
  normalized.metadata = metadata

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
  const controls = objectField(routeOf(payload) as unknown as Record<string, unknown>, 'controls')

  for (const control of node.controls) {
    if (!control.enabled) continue
    controls[control.key] = control.defaultValue
  }
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

/**
 * 记录协议发现的结论。
 * `route.protocol` / `route.transport` 是决策依据，写进 payload；
 * 归一化后的请求体只是解析过程的产物，仅作为返回值交给 trace 详情。
 */
function writeRouteProtocol(payload: Record<string, unknown>, protocol: WorkflowProtocol, transport: WorkflowTransport): Record<string, unknown> {
  const route = routeOf(payload)
  route.protocol = protocol
  route.transport = transport

  return buildNormalizedProtocolOutput(protocol, transport, payload)
}

function normalizeQueueIds(queueIds: string[]): string[] {
  return [...new Set(queueIds.map(id => id.trim()).filter(Boolean))]
}

/** 变量取值 → 队列 id 列表。字段可以是单个 id（字符串），也可以是 id 列表（字符串数组）。 */
function readQueueIdsFromValue(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeQueueIds(value.map(item => String(item)))
  if (typeof value === 'string') return normalizeQueueIds([value])
  return []
}

/**
 * 解析队列选择节点的落点。
 * - `fixed`：直接使用节点上配置的固定队列列表；
 * - `variable`：把 `variablePath` 指向的字段取值当作队列 id，取不到值时使用兜底队列
 *   （兜底队列为空表示不兜底，此时落点为空，由输出节点报「没有可用队列」）。
 */
function resolveQueueSelection(node: QueueSelectNode, payload: Record<string, unknown>): QueueSelection {
  if (node.source === 'variable') {
    const variablePath = node.variablePath.trim()
    const queueIds = variablePath ? readQueueIdsFromValue(getByPath(payload, variablePath)) : []
    if (queueIds.length > 0) {
      return {
        queueIds,
        matched: true,
        reason: `字段 ${variablePath} 取值 ${queueIds.join('、')}，直连该队列`,
      }
    }

    const fallbackQueueIds = normalizeQueueIds(node.fallbackQueueIds)
    return {
      queueIds: fallbackQueueIds,
      matched: false,
      reason: fallbackQueueIds.length > 0
        ? `字段 ${variablePath || '（未配置）'} 没有可用的队列取值，回落到兜底队列 ${fallbackQueueIds.join('、')}`
        : `字段 ${variablePath || '（未配置）'} 没有可用的队列取值，且未配置兜底队列`,
    }
  }

  const queueIds = normalizeQueueIds(node.queueIds)
  return {
    queueIds,
    matched: queueIds.length > 0,
    reason: queueIds.length > 0 ? `选择 ${queueIds.length} 个指定队列` : '尚未选择任何逻辑队列',
  }
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
          message: '控制输入已写入 route.controls',
          details: { controls: current.controls.filter(control => control.enabled).map(control => ({ key: control.key, kind: control.kind, value: control.defaultValue })) },
        })
        currentId = edgeTarget(edges, current.id)
        continue
      }

      if (current.kind === 'protocol-discovery') {
        const discovered = discoverProtocol(current, outputPayload)
        protocol = discovered.protocol
        const normalized = writeRouteProtocol(outputPayload, protocol, discovered.transport)
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
        const route = routeOf(outputPayload)
        const selection = resolveQueueSelection(current, outputPayload)
        queueSelections[current.id] = selection
        route.queueIds = selection.queueIds
        route.fallback = !selection.matched && selection.queueIds.length > 0
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: selection.queueIds.length > 0,
          message: selection.reason,
          details: {
            queueIds: selection.queueIds,
            matched: selection.matched,
            source: current.source,
            variablePath: current.variablePath,
          },
        })
        currentId = edgeTarget(edges, current.id)
        continue
      }

      if (current.kind === 'output') {
        const route = routeOf(outputPayload)
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: route.queueIds.length > 0,
          message: route.queueIds.length > 0
            ? `到达输出节点，落点队列 ${route.queueIds.join('、')}`
            : '到达输出节点，但没有得到任何可用队列',
          details: {
            queueIds: route.queueIds,
            fallback: route.fallback,
            includeTrace: current.includeTrace,
            summaryLevel: current.summaryLevel,
          },
        })
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
