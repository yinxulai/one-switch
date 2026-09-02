import type {
  ConditionOperator,
  ConditionRule,
  ControlInputNode,
  LogicalModelDecision,
  ProtocolDiscoveryNode,
  RouteContext,
  RouteContextEnvelope,
  RouteContextInput,
  WorkflowProtocol,
  WorkflowNodeModel,
  WorkflowRunResult,
  WorkflowTrace,
} from './types'
import { getLogicalModelById } from './logical-model-catalog'

type LogicalModelSelectorNode = Extract<WorkflowNodeModel, { kind: 'logical-model-selector' }>

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

  if (operator === 'startsWith') {
    return String(actual ?? '').startsWith(rule.value ?? '')
  }

  if (operator === 'in') {
    const items = rule.valueType === 'enum' && rule.enumOptions?.length
      ? rule.enumOptions
      : splitSet(rule.value)
    return items.includes(String(actual ?? ''))
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

function pickModelDecision(protocol: WorkflowProtocol, node: LogicalModelSelectorNode): LogicalModelDecision {
  const logicalModel = getLogicalModelById(node.logicalModelId)
  if (!logicalModel) {
    return {
      selectedModel: node.logicalModelId,
      targetQueue: '',
      matched: false,
      reason: '逻辑模型不存在',
    }
  }

  if (!logicalModel.enabled) {
    return {
      selectedModel: logicalModel.id,
      targetQueue: '',
      matched: false,
      reason: `逻辑模型 ${logicalModel.id} 已禁用`,
    }
  }

  if (!logicalModel.supportedProtocols.includes(protocol)) {
    return {
      selectedModel: logicalModel.id,
      targetQueue: '',
      matched: false,
      reason: `逻辑模型 ${logicalModel.id} 不支持协议 ${protocol}`,
    }
  }

  return {
    selectedModel: logicalModel.id,
    targetQueue: logicalModel.targetQueue,
    matched: true,
    reason: `逻辑模型 ${logicalModel.id} 路由到队列 ${logicalModel.targetQueue}`,
  }
}

function nextForProtocol(node: ProtocolDiscoveryNode, protocol: WorkflowProtocol): string {
  return node.branches[protocol]
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

export function runWorkflow(nodes: WorkflowNodeModel[], inputPayload: unknown): WorkflowRunResult {
  const envelope = normalizeInputPayload(inputPayload)
  const outputPayload = envelope.payload
  const trace: WorkflowTrace[] = []
  const byId = new Map(nodes.map(node => [node.id, node]))

  const start = nodes.find(node => node.kind === 'input')
  if (!start) {
    return {
      outputPayload,
      targetQueue: null,
      protocol: 'unknown',
      routeDecision: null,
      stopReason: 'error',
      trace: [buildMissingInputTrace('缺少输入节点')],
    }
  }

  let current: WorkflowNodeModel | undefined = start
  let protocol: WorkflowProtocol = 'unknown'
  let routeDecision: LogicalModelDecision | null = null
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
        disabledNext = current.nextFalse
      } else if (current.kind === 'logical-model-selector') {
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
      const actual = getByPath(outputPayload, current.rule.fieldPath)
      const passed = evaluateCondition(current.rule, actual)
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: passed,
        message: passed ? `条件命中，走 true -> ${current.nextTrue}` : `条件不命中，走 false -> ${current.nextFalse}`,
        details: {
          fieldPath: current.rule.fieldPath,
          operator: current.rule.operator,
          compareValue: current.rule.value,
          actual,
        },
      })
      current = byId.get(passed ? current.nextTrue : current.nextFalse)
      if (!current) {
        stopReason = 'missing-next'
      }
      continue
    }

    if (current.kind === 'logical-model-selector') {
      routeDecision = pickModelDecision(protocol, current)
      ;(outputPayload.metadata as Record<string, unknown>).routeDecision = routeDecision
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: Boolean(routeDecision.targetQueue),
        message: routeDecision.reason,
        details: {
          selectedModel: routeDecision.selectedModel,
          targetQueue: routeDecision.targetQueue,
          protocol,
        },
      })
      current = byId.get(current.next)
      if (!current) {
        stopReason = 'missing-next'
      }
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
    targetQueue: routeDecision?.targetQueue ?? null,
    protocol,
    routeDecision,
    stopReason,
    trace,
  }
}

export function createRouteContextInput(payload: RouteContextInput): RouteContextEnvelope {
  return normalizeInputPayload(payload)
}
