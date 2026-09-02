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

function removeByPath(payload: unknown, path: string): boolean {
  const segments = parsePath(path)
  if (!segments.length || !payload || typeof payload !== 'object') {
    return false
  }

  let current = payload as Record<string, unknown>
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index]
    const next = current[key]
    if (!next || typeof next !== 'object') {
      return false
    }
    current = next as Record<string, unknown>
  }

  const leaf = segments[segments.length - 1]
  if (!(leaf in current)) {
    return false
  }
  delete current[leaf]
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

function evaluateCondition(actual: unknown, operator: 'eq' | 'neq' | 'contains' | 'startsWith' | 'gt' | 'exists' | 'regex', expected: string): boolean {
  if (operator === 'exists') return actual !== undefined && actual !== null
  if (operator === 'eq') return String(actual ?? '') === expected
  if (operator === 'neq') return String(actual ?? '') !== expected
  if (operator === 'contains') return String(actual ?? '').includes(expected)
  if (operator === 'startsWith') return String(actual ?? '').startsWith(expected)
  if (operator === 'regex') {
    try {
      return new RegExp(expected).test(String(actual ?? ''))
    } catch {
      return false
    }
  }
  const current = Number(actual)
  const target = Number(expected)
  return Number.isFinite(current) && Number.isFinite(target) && current > target
}

function evaluateStringMatch(actual: unknown, operator: 'contains' | 'eq' | 'regex', expected: string): boolean {
  const value = String(actual ?? '')
  if (operator === 'eq') return value === expected
  if (operator === 'contains') return value.includes(expected)
  try {
    return new RegExp(expected).test(value)
  } catch {
    return false
  }
}

function nextNodeId(node: WorkflowNodeModel): string | null {
  if (node.kind === 'output' || node.kind === 'note') return null
  if (node.kind === 'condition' || node.kind === 'filter') return node.nextFalse
  return node.next
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
      const nextId = nextNodeId(current)
      if (!nextId) {
        stopReason = 'missing-next'
        break
      }
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

    if (current.kind === 'note') {
      trace.push({ nodeId: current.id, nodeName: current.name, kind: current.kind, success: true, message: '备注节点，不参与执行' })
      stopReason = 'missing-next'
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

    if (current.kind === 'filter') {
      const actual = getByPath(outputPayload, current.path)
      let passed = false
      if (current.mode === 'in-list') {
        const candidates = current.value.split(',').map(item => item.trim()).filter(Boolean)
        passed = candidates.includes(String(actual ?? ''))
      } else if (current.mode === 'eq') {
        passed = evaluateStringMatch(actual, 'eq', current.value)
      } else if (current.mode === 'contains') {
        passed = evaluateStringMatch(actual, 'contains', current.value)
      } else {
        passed = evaluateStringMatch(actual, 'regex', current.value)
      }

      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success: passed,
        message: passed ? `筛选命中，走 true -> ${current.nextTrue}` : `筛选不命中，走 false -> ${current.nextFalse}`,
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

    if (current.kind === 'json-edit') {
      let success = false
      let message = ''

      if (current.operation === 'remove') {
        success = removeByPath(outputPayload, current.path)
        message = success ? `已删除 ${current.path}` : `删除失败 ${current.path}`
      } else if (current.operation === 'merge') {
        const existing = getByPath(outputPayload, current.path)
        const parsed = parseLiteral(current.value)
        if (existing && typeof existing === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(existing) && !Array.isArray(parsed)) {
          success = setByPath(outputPayload, current.path, { ...(existing as Record<string, unknown>), ...(parsed as Record<string, unknown>) })
          message = success ? `已合并 ${current.path}` : `合并失败 ${current.path}`
        } else {
          message = 'merge 仅支持对象合并'
        }
      } else {
        success = setByPath(outputPayload, current.path, parseLiteral(current.value))
        message = success ? `已写入 ${current.path}` : `写入失败 ${current.path}`
      }

      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success,
        message,
      })
      current = byId.get(current.next)
      if (!current) stopReason = 'missing-next'
      continue
    }

    if (current.kind === 'text-replace') {
      const source = getByPath(outputPayload, current.path)
      if (typeof source !== 'string') {
        trace.push({
          nodeId: current.id,
          nodeName: current.name,
          kind: current.kind,
          success: false,
          message: `${current.path} 不是字符串`,
        })
        current = byId.get(current.next)
        if (!current) stopReason = 'missing-next'
        continue
      }

      let replaced = source
      let success = true
      let message = `已替换 ${current.path}`
      if (current.useRegex) {
        try {
          replaced = source.replace(new RegExp(current.search, current.regexFlags.trim()), current.replace)
        } catch {
          success = false
          message = '正则表达式无效'
        }
      } else {
        replaced = source.split(current.search).join(current.replace)
      }

      if (success) {
        setByPath(outputPayload, current.path, replaced)
      }

      trace.push({
        nodeId: current.id,
        nodeName: current.name,
        kind: current.kind,
        success,
        message,
      })
      current = byId.get(current.next)
      if (!current) stopReason = 'missing-next'
      continue
    }

    const candidates = (current.candidateQueues ?? []).map(item => item.trim()).filter(Boolean)
    const selectedQueue = candidates[0] ?? current.queueId.trim()
    const taskPath = current.taskPath?.trim() || 'request.body.task'
    const taskActual = getByPath(outputPayload, taskPath)
    const taskOperator = current.taskOperator ?? 'none'
    const taskExpected = current.taskValue ?? ''
    const fallbackQueue = current.taskMissQueueId?.trim() || current.queueId.trim()

    const taskMatched = taskOperator === 'none'
      ? true
      : evaluateStringMatch(taskActual, taskOperator === 'contains' || taskOperator === 'eq' || taskOperator === 'regex' ? taskOperator : 'contains', taskExpected)

    const nextQueue = taskMatched ? selectedQueue : fallbackQueue
    queue = nextQueue || queue
    trace.push({
      nodeId: current.id,
      nodeName: current.name,
      kind: current.kind,
      success: Boolean(nextQueue),
      message: nextQueue
        ? taskMatched
          ? `路由队列 ${nextQueue}`
          : `任务未命中，回退到 ${nextQueue}`
        : '队列为空，忽略',
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
