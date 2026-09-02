import type { WorkflowNodeModel, WorkflowRunResult, WorkflowTrace } from './types'

function clonePayload<T>(payload: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(payload)
  }
  return JSON.parse(JSON.stringify(payload)) as T
}

function parsePath(path: string): string[] {
  return path.split('.').map(item => item.trim()).filter(Boolean)
}

function getByPath(payload: unknown, path: string): unknown {
  const segments = parsePath(path)
  let current: unknown = payload
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function setByPath(payload: unknown, path: string, value: unknown): boolean {
  const segments = parsePath(path)
  if (!segments.length || !payload || typeof payload !== 'object') {
    return false
  }
  let current = payload as Record<string, unknown>
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index]
    const next = current[key]
    if (!next || typeof next !== 'object') {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
  return true
}

function parseLiteral(raw: string): unknown {
  const value = raw.trim()
  if (!value) return ''
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return raw
    }
  }
  return raw
}

function applyTransform(value: unknown, mode: 'trim' | 'uppercase' | 'lowercase' | 'stringify'): { ok: boolean; value: unknown; message: string } {
  if (mode === 'stringify') {
    return { ok: true, value: JSON.stringify(value), message: '已序列化' }
  }
  if (typeof value !== 'string') {
    return { ok: false, value, message: '转换器当前仅支持字符串' }
  }
  if (mode === 'trim') return { ok: true, value: value.trim(), message: '已 trim' }
  if (mode === 'uppercase') return { ok: true, value: value.toUpperCase(), message: '已 uppercase' }
  return { ok: true, value: value.toLowerCase(), message: '已 lowercase' }
}

function evaluateCondition(actual: unknown, operator: 'eq' | 'contains' | 'gt' | 'exists', expected: string): boolean {
  if (operator === 'exists') return actual !== undefined && actual !== null
  if (operator === 'eq') return String(actual ?? '') === expected
  if (operator === 'contains') return String(actual ?? '').includes(expected)
  const current = Number(actual)
  const target = Number(expected)
  return Number.isFinite(current) && Number.isFinite(target) && current > target
}

export function runWorkflow(nodes: WorkflowNodeModel[], inputPayload: unknown): WorkflowRunResult {
  const outputPayload = clonePayload(inputPayload)
  const trace: WorkflowTrace[] = []
  const byId = new Map(nodes.map(node => [node.id, node]))

  const start = nodes.find(node => node.kind === 'input')
  if (!start) {
    return {
      outputPayload,
      targetQueue: null,
      stopReason: 'error',
      trace: [{ nodeId: '-', nodeName: '初始化', kind: 'input', success: false, message: '缺少输入节点' }],
    }
  }

  let current: WorkflowNodeModel | undefined = start
  let queue: string | null = null
  let stopReason: WorkflowRunResult['stopReason'] = 'missing-next'
  let steps = 0

  while (current && steps < 80) {
    steps += 1

    if (!current.enabled && current.kind !== 'input' && current.kind !== 'output') {
      trace.push({ nodeId: current.id, nodeName: current.name, kind: current.kind, success: true, message: '节点禁用，跳过' })
      const nextId = current.kind === 'condition' ? current.nextFalse : current.next
      current = byId.get(nextId)
      if (!current) stopReason = 'missing-next'
      continue
    }

    if (current.kind === 'input') {
      trace.push({ nodeId: current.id, nodeName: current.name, kind: current.kind, success: true, message: '输入进入流程' })
      current = byId.get(current.next)
      if (!current) stopReason = 'missing-next'
      continue
    }

    if (current.kind === 'output') {
      trace.push({ nodeId: current.id, nodeName: current.name, kind: current.kind, success: true, message: '到达输出节点' })
      stopReason = 'output'
      current = undefined
      continue
    }

    if (current.kind === 'condition') {
      const actual = getByPath(outputPayload, current.path)
      const passed = evaluateCondition(actual, current.operator, current.value)
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: passed,
        message: passed ? `条件命中，走 true -> ${current.nextTrue}` : `条件不命中，走 false -> ${current.nextFalse}`,
      })
      current = byId.get(passed ? current.nextTrue : current.nextFalse)
      if (!current) stopReason = 'missing-next'
      continue
    }

    if (current.kind === 'modifier') {
      const ok = setByPath(outputPayload, current.path, parseLiteral(current.value))
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: ok,
        message: ok ? `已写入 ${current.path}` : `写入失败 ${current.path}`,
      })
      current = byId.get(current.next)
      if (!current) stopReason = 'missing-next'
      continue
    }

    if (current.kind === 'transformer') {
      const source = getByPath(outputPayload, current.fromPath)
      const transformed = applyTransform(source, current.mode)
      if (transformed.ok) {
        setByPath(outputPayload, current.toPath, transformed.value)
      }
      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: transformed.ok,
        message: transformed.ok ? `${current.fromPath} -> ${current.toPath}` : transformed.message,
      })
      current = byId.get(current.next)
      if (!current) stopReason = 'missing-next'
      continue
    }

    queue = current.queueId.trim() || queue
    trace.push({
      nodeId: current.id,
      nodeName: current.name,
      kind: current.kind,
      success: Boolean(current.queueId.trim()),
      message: current.queueId.trim() ? `目标队列 ${current.queueId}` : '队列为空，忽略',
    })
    current = byId.get(current.next)
    if (!current) stopReason = 'missing-next'
  }

  if (steps >= 80) {
    stopReason = 'max-steps'
  }

  return {
    outputPayload,
    targetQueue: queue,
    stopReason,
    trace,
  }
}
