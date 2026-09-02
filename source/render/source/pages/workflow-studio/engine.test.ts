import { describe, expect, it } from 'vitest'
import { runWorkflow } from './engine'
import type { WorkflowNodeModel } from './types'

function baseFlow(nodes: WorkflowNodeModel[]): WorkflowNodeModel[] {
  return [
    {
      id: 'input',
      kind: 'input',
      name: '输入',
      enabled: true,
      description: 'input',
      position: { x: 0, y: 0 },
      next: nodes[0]?.id ?? 'output',
    },
    ...nodes,
    {
      id: 'output',
      kind: 'output',
      name: '输出',
      enabled: true,
      description: 'output',
      position: { x: 100, y: 0 },
    },
  ]
}

describe('workflow-studio engine', () => {
  it('applies text replace and json merge nodes', () => {
    const nodes = baseFlow([
      {
        id: 'replace',
        kind: 'text-replace',
        name: '替换',
        enabled: true,
        description: 'replace',
        position: { x: 20, y: 0 },
        path: 'request.prompt',
        search: 'article',
        replace: 'document',
        useRegex: false,
        regexFlags: 'g',
        next: 'merge',
      },
      {
        id: 'merge',
        kind: 'json-edit',
        name: '合并',
        enabled: true,
        description: 'merge',
        position: { x: 40, y: 0 },
        path: 'metadata',
        operation: 'merge',
        value: '{"tag":"workflow"}',
        next: 'output',
      },
    ])

    const result = runWorkflow(nodes, {
      request: { prompt: 'summarize this article' },
      metadata: { source: 'desktop' },
    })

    expect(result.stopReason).toBe('output')
    expect(result.outputPayload).toEqual({
      request: { prompt: 'summarize this document' },
      metadata: { source: 'desktop', tag: 'workflow' },
    })
  })

  it('supports json remove operation', () => {
    const nodes = baseFlow([
      {
        id: 'remove',
        kind: 'json-edit',
        name: '删除',
        enabled: true,
        description: 'remove',
        position: { x: 20, y: 0 },
        path: 'metadata.debug',
        operation: 'remove',
        value: '',
        next: 'output',
      },
    ])

    const result = runWorkflow(nodes, {
      metadata: { debug: true, source: 'desktop' },
    })

    expect(result.stopReason).toBe('output')
    expect(result.outputPayload).toEqual({
      metadata: { source: 'desktop' },
    })
  })

  it('marks regex errors while keeping workflow running', () => {
    const nodes = baseFlow([
      {
        id: 'replace',
        kind: 'text-replace',
        name: '替换',
        enabled: true,
        description: 'replace',
        position: { x: 20, y: 0 },
        path: 'request.prompt',
        search: '[broken',
        replace: 'x',
        useRegex: true,
        regexFlags: 'g',
        next: 'output',
      },
    ])

    const result = runWorkflow(nodes, {
      request: { prompt: 'hello' },
    })

    expect(result.stopReason).toBe('output')
    expect(result.trace.some(item => item.kind === 'text-replace' && item.success === false)).toBe(true)
    expect(result.outputPayload).toEqual({
      request: { prompt: 'hello' },
    })
  })

  it('supports startsWith and regex condition operators', () => {
    const nodes = baseFlow([
      {
        id: 'condition-prefix',
        kind: 'condition',
        name: '前缀判断',
        enabled: true,
        description: 'startsWith',
        position: { x: 20, y: 0 },
        path: 'request.path',
        operator: 'startsWith',
        value: '/v1/',
        nextTrue: 'condition-regex',
        nextFalse: 'output',
      },
      {
        id: 'condition-regex',
        kind: 'condition',
        name: '正则判断',
        enabled: true,
        description: 'regex',
        position: { x: 40, y: 0 },
        path: 'request.tenant',
        operator: 'regex',
        value: '^vip-',
        nextTrue: 'set-tag',
        nextFalse: 'output',
      },
      {
        id: 'set-tag',
        kind: 'modifier',
        name: '标记',
        enabled: true,
        description: 'mark',
        position: { x: 60, y: 0 },
        path: 'metadata.route',
        value: 'vip',
        next: 'output',
      },
    ])

    const result = runWorkflow(nodes, {
      request: { path: '/v1/messages', tenant: 'vip-cn' },
      metadata: {},
    })

    expect(result.stopReason).toBe('output')
    expect(result.outputPayload).toEqual({
      request: { path: '/v1/messages', tenant: 'vip-cn' },
      metadata: { route: 'vip' },
    })
  })

  it('routes by task filter and queue fallback', () => {
    const nodes = baseFlow([
      {
        id: 'task-filter',
        kind: 'filter',
        name: '任务筛选',
        enabled: true,
        description: 'filter task',
        position: { x: 20, y: 0 },
        path: 'request.body.task',
        mode: 'in-list',
        value: 'summarize,translate',
        nextTrue: 'queue-mobile',
        nextFalse: 'queue-desktop',
      },
      {
        id: 'queue-mobile',
        kind: 'queue',
        name: '移动端队列',
        enabled: true,
        description: 'mobile queue',
        position: { x: 40, y: 0 },
        queueId: 'queue-vip-cn',
        candidateQueues: ['queue-vip-cn', 'queue-fallback'],
        taskPath: 'request.body.task',
        taskOperator: 'eq',
        taskValue: 'summarize',
        taskMissQueueId: 'queue-default',
        next: 'output',
      },
      {
        id: 'queue-desktop',
        kind: 'queue',
        name: '桌面端队列',
        enabled: true,
        description: 'desktop queue',
        position: { x: 60, y: 0 },
        queueId: 'queue-default',
        candidateQueues: ['queue-default'],
        taskPath: 'request.body.task',
        taskOperator: 'none',
        taskValue: '',
        taskMissQueueId: 'queue-default',
        next: 'output',
      },
    ])

    const hit = runWorkflow(nodes, {
      request: { body: { task: 'summarize' } },
    })
    expect(hit.targetQueue).toBe('queue-vip-cn')

    const miss = runWorkflow(nodes, {
      request: { body: { task: 'rewrite' } },
    })
    expect(miss.targetQueue).toBe('queue-default')
  })
})
