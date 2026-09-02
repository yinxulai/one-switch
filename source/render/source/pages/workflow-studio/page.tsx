import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowRight, CirclePlay, Hand, Lock, LockOpen, LocateFixed, MousePointer2, Plus, Save, StickyNote } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { runWorkflow } from './engine'
import type { WorkflowNodeKind, WorkflowNodeModel, WorkflowRunResult } from './types'

const queueOptions = ['queue-vip-cn', 'queue-default', 'queue-low-priority', 'queue-fallback']
const workflowStorageKey = 'one-switch.workflow-studio.models.v1'

function normalizeQueueNode(model: WorkflowNodeModel): WorkflowNodeModel {
  if (model.kind !== 'queue') return model
  const candidateQueues = Array.isArray(model.candidateQueues) && model.candidateQueues.length > 0
    ? model.candidateQueues
    : [model.queueId]
  return {
    ...model,
    candidateQueues,
    taskPath: model.taskPath?.trim() || 'request.body.task',
    taskOperator: model.taskOperator ?? 'none',
    taskValue: model.taskValue ?? '',
    taskMissQueueId: model.taskMissQueueId?.trim() || model.queueId,
  }
}

const initialModels: WorkflowNodeModel[] = [
  {
    id: 'input',
    kind: 'input',
    name: '输入',
    enabled: true,
    description: '承接代理入口请求，提取 User-Agent 进行路由决策。',
    position: { x: 80, y: 250 },
    next: 'normalize-ua',
  },
  {
    id: 'normalize-ua',
    kind: 'transformer',
    name: 'UA 归一化',
    enabled: true,
    description: '将 UA 转成小写，便于后续稳定匹配。',
    position: { x: 350, y: 250 },
    fromPath: 'request.headers.userAgent',
    toPath: 'routing.ua',
    mode: 'lowercase',
    next: 'condition-bot',
  },
  {
    id: 'condition-bot',
    kind: 'condition',
    name: '识别爬虫请求',
    enabled: true,
    description: '爬虫/抓取请求进入低优先级队列，保护主路径延迟。',
    position: { x: 640, y: 250 },
    path: 'routing.ua',
    operator: 'contains',
    value: 'bot',
    nextTrue: 'mark-bot',
    nextFalse: 'condition-mobile',
  },
  {
    id: 'mark-bot',
    kind: 'json-edit',
    name: '写入路由标签: bot',
    enabled: true,
    description: '记录路由原因，便于日志与问题排查。',
    position: { x: 920, y: 120 },
    path: 'routing.result',
    operation: 'set',
    value: '{"bucket":"bot","reason":"ua contains bot"}',
    next: 'queue-bot',
  },
  {
    id: 'queue-bot',
    kind: 'queue',
    name: '爬虫队列',
    enabled: true,
    description: '降低 bot 流量对业务请求的影响。',
    position: { x: 1200, y: 120 },
    queueId: 'queue-low-priority',
    candidateQueues: ['queue-low-priority'],
    taskPath: 'request.body.task',
    taskOperator: 'none',
    taskValue: '',
    taskMissQueueId: 'queue-default',
    next: 'output',
  },
  {
    id: 'condition-mobile',
    kind: 'filter',
    name: '任务筛选: mobile-only',
    enabled: true,
    description: '只让移动端 summarize/translate 任务进入高优先队列。',
    position: { x: 920, y: 320 },
    path: 'request.body.task',
    mode: 'in-list',
    value: 'summarize,translate',
    nextTrue: 'mark-mobile',
    nextFalse: 'mark-desktop',
  },
  {
    id: 'mark-mobile',
    kind: 'json-edit',
    name: '写入路由标签: mobile',
    enabled: true,
    description: '标记移动端链路，便于后续观测。',
    position: { x: 1200, y: 260 },
    path: 'routing.result',
    operation: 'set',
    value: '{"bucket":"mobile","reason":"ua contains mobile"}',
    next: 'queue-mobile',
  },
  {
    id: 'queue-mobile',
    kind: 'queue',
    name: '移动端队列',
    enabled: true,
    description: '移动端进入低延迟队列。',
    position: { x: 1460, y: 260 },
    queueId: 'queue-vip-cn',
    candidateQueues: ['queue-vip-cn', 'queue-fallback'],
    taskPath: 'request.body.task',
    taskOperator: 'none',
    taskValue: '',
    taskMissQueueId: 'queue-default',
    next: 'output',
  },
  {
    id: 'mark-desktop',
    kind: 'json-edit',
    name: '写入路由标签: desktop',
    enabled: true,
    description: '桌面请求保留在默认服务队列。',
    position: { x: 1200, y: 410 },
    path: 'routing.result',
    operation: 'set',
    value: '{"bucket":"desktop","reason":"default fallback"}',
    next: 'queue-desktop',
  },
  {
    id: 'queue-desktop',
    kind: 'queue',
    name: '桌面端队列',
    enabled: true,
    description: '桌面流量进入默认队列。',
    position: { x: 1460, y: 410 },
    queueId: 'queue-default',
    candidateQueues: ['queue-default'],
    taskPath: 'request.body.task',
    taskOperator: 'none',
    taskValue: '',
    taskMissQueueId: 'queue-default',
    next: 'output',
  },
  {
    id: 'output',
    kind: 'output',
    name: '输出',
    enabled: true,
    description: '返回路由结果与目标队列。',
    position: { x: 1760, y: 330 },
  },
]

const samplePayload = {
  request: {
    path: '/v1/messages',
    method: 'POST',
    headers: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    },
    body: {
      model: 'gpt-4o-mini',
      task: 'summarize',
      input: 'Summarize this article in Chinese.',
    },
  },
  metadata: { source: 'desktop-app' },
}

type WorkflowNodeData = {
  model: WorkflowNodeModel
  onOpen: (nodeId: string) => void
}

type WorkflowCanvasNodeType =
  | 'wf-input'
  | 'wf-output'
  | 'condition'
  | 'filter'
  | 'modifier'
  | 'transformer'
  | 'json-edit'
  | 'text-replace'
  | 'note'
  | 'queue'

function toCanvasNodeType(kind: WorkflowNodeKind): WorkflowCanvasNodeType {
  if (kind === 'input') return 'wf-input'
  if (kind === 'output') return 'wf-output'
  return kind
}

function kindLabel(kind: WorkflowNodeKind): string {
  if (kind === 'input') return '输入'
  if (kind === 'output') return '输出'
  if (kind === 'condition') return '条件'
  if (kind === 'filter') return '筛选'
  if (kind === 'modifier') return '修改'
  if (kind === 'transformer') return '转换'
  if (kind === 'json-edit') return 'JSON'
  if (kind === 'text-replace') return '替换'
  if (kind === 'note') return '备注'
  return '队列'
}

function kindTone(kind: WorkflowNodeKind): string {
  if (kind === 'input') return 'bg-info/14 text-info'
  if (kind === 'output') return 'bg-success/14 text-success-foreground'
  if (kind === 'condition') return 'bg-warning/14 text-warning-foreground'
  if (kind === 'filter') return 'bg-cyan-500/12 text-cyan-500'
  if (kind === 'modifier') return 'bg-primary/14 text-primary'
  if (kind === 'transformer') return 'bg-primary/10 text-primary'
  if (kind === 'json-edit') return 'bg-indigo-500/12 text-indigo-500'
  if (kind === 'text-replace') return 'bg-rose-500/12 text-rose-500'
  if (kind === 'note') return 'bg-amber-500/14 text-amber-600 dark:text-amber-400'
  return 'bg-muted text-muted-foreground'
}

function modelSummary(model: WorkflowNodeModel): string {
  if (model.kind === 'input') return `next -> ${model.next}`
  if (model.kind === 'output') return '流程输出终点'
  if (model.kind === 'condition') return model.operator === 'exists' ? `${model.path} exists` : `${model.path} ${model.operator} ${model.value}`
  if (model.kind === 'filter') return `${model.path} ${model.mode} ${model.value}`
  if (model.kind === 'modifier') return `${model.path} = ${model.value}`
  if (model.kind === 'transformer') return `${model.fromPath} -> ${model.toPath} (${model.mode})`
  if (model.kind === 'json-edit') return `${model.operation} ${model.path}`
  if (model.kind === 'text-replace') return `${model.path}: ${model.search} -> ${model.replace}`
  if (model.kind === 'note') return model.content
  return `queue: ${model.candidateQueues?.join(', ') || model.queueId}`
}

function isFixedNode(model: WorkflowNodeModel): boolean {
  return model.kind === 'input' || model.kind === 'output'
}

const BaseNodeView = memo(function BaseNodeView({ data }: { data: WorkflowNodeData }) {
  const model = data.model
  const fixed = isFixedNode(model)

  return (
    <button
      type="button"
      onClick={() => data.onOpen(model.id)}
      className={cn(
        'relative block w-64 overflow-visible rounded-xl bg-card px-3 py-2 text-left ring-1 ring-foreground/10 transition-colors hover:bg-card/85',
        !model.enabled && !fixed && 'opacity-55',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', kindTone(model.kind))}>{kindLabel(model.kind)}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{fixed ? 'fixed' : 'editable'}</span>
      </div>
      <div className="truncate text-xs font-medium">{model.name}</div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">{modelSummary(model)}</div>

      {model.kind !== 'input' && model.kind !== 'note' && (
        <>
          <Handle type="target" position={Position.Left} style={{ top: '50%' }} className="size-3! border-0! bg-info!" />
          <span className="pointer-events-none absolute -left-7 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">in</span>
        </>
      )}

      {model.kind !== 'output' && model.kind !== 'condition' && model.kind !== 'filter' && model.kind !== 'note' && (
        <>
          <Handle type="source" position={Position.Right} style={{ top: '50%' }} className="size-3! border-0! bg-success!" />
          <span className="pointer-events-none absolute -right-8 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">out</span>
        </>
      )}

      {model.kind === 'note' && <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] leading-5 text-amber-700 dark:text-amber-300">{model.content || '双击编辑备注'}</div>}

      {(model.kind === 'condition' || model.kind === 'filter') && (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: 30 }} className="size-3! border-0! bg-success!" />
          <Handle id="false" type="source" position={Position.Right} style={{ top: 56 }} className="size-3! border-0! bg-warning!" />
          <span className="pointer-events-none absolute -right-11 top-5 text-[10px] text-success">true</span>
          <span className="pointer-events-none absolute -right-12 top-12 text-[10px] text-warning">false</span>
        </>
      )}
    </button>
  )
})

const nodeTypes = {
  'wf-input': BaseNodeView,
  'wf-output': BaseNodeView,
  condition: BaseNodeView,
  filter: BaseNodeView,
  modifier: BaseNodeView,
  transformer: BaseNodeView,
  'json-edit': BaseNodeView,
  'text-replace': BaseNodeView,
  note: BaseNodeView,
  queue: BaseNodeView,
}

const defaultEdgeOptions = {
  animated: false,
  style: { strokeWidth: 1.6 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 14,
    height: 14,
  },
} satisfies NonNullable<React.ComponentProps<typeof ReactFlow<Node<WorkflowNodeData>, Edge>>['defaultEdgeOptions']>

function computeContextMenuPosition(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  const menuWidth = 176
  const menuHeight = 260
  const gap = 8
  const localX = clientX - rect.left
  const localY = clientY - rect.top
  const x = Math.max(gap, Math.min(localX, rect.width - menuWidth - gap))
  const y = Math.max(gap, Math.min(localY, rect.height - menuHeight - gap))
  return { x, y }
}

function buildFlowEdges(models: WorkflowNodeModel[]): Edge[] {
  const edges: Edge[] = []
  for (const model of models) {
    if (model.kind === 'output' || model.kind === 'note') continue
    if (model.kind === 'condition' || model.kind === 'filter') {
      edges.push({ id: `${model.id}:true->${model.nextTrue}`, source: model.id, sourceHandle: 'true', target: model.nextTrue, animated: true })
      edges.push({ id: `${model.id}:false->${model.nextFalse}`, source: model.id, sourceHandle: 'false', target: model.nextFalse })
      continue
    }
    edges.push({ id: `${model.id}->${model.next}`, source: model.id, target: model.next })
  }
  return edges
}

function createNodeByKind(kind: WorkflowNodeKind, position: { x: number; y: number }, nextId: string): WorkflowNodeModel {
  const id = `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
  if (kind === 'condition') {
    return {
      id,
      kind,
      name: '条件节点',
      enabled: true,
      description: '根据字段命中不同分支。',
      position,
      path: 'request.path',
      operator: 'contains',
      value: '/v1/',
      nextTrue: nextId,
      nextFalse: nextId,
    }
  }

  if (kind === 'filter') {
    return {
      id,
      kind,
      name: '筛选节点',
      enabled: true,
      description: '按字段执行通用筛选，分流 true/false。',
      position,
      path: 'request.body.task',
      mode: 'in-list',
      value: 'summarize,translate',
      nextTrue: nextId,
      nextFalse: nextId,
    }
  }

  if (kind === 'modifier') {
    return {
      id,
      kind,
      name: '修改节点',
      enabled: true,
      description: '对 payload 写入新的字段值。',
      position,
      path: 'metadata.tag',
      value: 'prototype',
      next: nextId,
    }
  }

  if (kind === 'transformer') {
    return {
      id,
      kind,
      name: '转换节点',
      enabled: true,
      description: '对字段执行文本转换。',
      position,
      fromPath: 'request.prompt',
      toPath: 'request.prompt',
      mode: 'trim',
      next: nextId,
    }
  }

  if (kind === 'json-edit') {
    return {
      id,
      kind,
      name: 'JSON 修改节点',
      enabled: true,
      description: '按路径 set/remove/merge JSON 字段。',
      position,
      path: 'metadata',
      operation: 'merge',
      value: '{"source":"workflow"}',
      next: nextId,
    }
  }

  if (kind === 'text-replace') {
    return {
      id,
      kind,
      name: '文本替换节点',
      enabled: true,
      description: '对目标字符串做普通替换或正则替换。',
      position,
      path: 'request.prompt',
      search: 'article',
      replace: 'document',
      useRegex: false,
      regexFlags: 'g',
      next: nextId,
    }
  }

  if (kind === 'note') {
    return {
      id,
      kind,
      name: '备注',
      enabled: true,
      description: '用于记录流程说明，不参与执行。',
      position,
      content: '在这里记录设计意图和注意事项。',
    }
  }

  return {
    id,
    kind: 'queue',
    name: '队列节点',
    enabled: true,
    description: '设置调度目标队列。',
    position,
    queueId: queueOptions[1],
    candidateQueues: [queueOptions[1]],
    taskPath: 'request.body.task',
    taskOperator: 'none',
    taskValue: '',
    taskMissQueueId: queueOptions[1],
    next: nextId,
  }
}

function WorkflowStudioCanvas() {
  const toast = useToast()
  const flow = useReactFlow<Node<WorkflowNodeData>, Edge>()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const cachedNodesRef = useRef<Map<string, Node<WorkflowNodeData>>>(new Map())
  const hasFitViewRef = useRef(false)
  const dragRafRef = useRef<number | null>(null)
  const pendingDragRef = useRef<{ id: string; position: { x: number; y: number } } | null>(null)

  const [models, setModels] = useState<WorkflowNodeModel[]>(() => {
    try {
      const raw = localStorage.getItem(workflowStorageKey)
      if (!raw) return initialModels
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed) || parsed.length === 0) return initialModels
      return (parsed as WorkflowNodeModel[]).map(model => normalizeQueueNode(model))
    } catch {
      return initialModels
    }
  })
  const [menuKind, setMenuKind] = useState<WorkflowNodeKind>('modifier')
  const [dragEnabled, setDragEnabled] = useState(true)
  const [dockMode, setDockMode] = useState<'select' | 'pan'>('select')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; clientX: number; clientY: number } | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  const [payloadText, setPayloadText] = useState(JSON.stringify(samplePayload, null, 2))
  const [payloadError, setPayloadError] = useState('')
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null)
  const [canvasHeight, setCanvasHeight] = useState(620)

  const handleOpenNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setDrawerOpen(true)
  }, [])

  const flowNodes = useMemo(() => {
    const previous = cachedNodesRef.current
    const nextCache = new Map<string, Node<WorkflowNodeData>>()
    const result: Node<WorkflowNodeData>[] = []

    for (const model of models) {
      const draggable = dragEnabled && dockMode === 'select' && !isFixedNode(model)
      const previousNode = previous.get(model.id)
      if (previousNode && previousNode.data.model === model && previousNode.data.onOpen === handleOpenNode && previousNode.draggable === draggable) {
        nextCache.set(model.id, previousNode)
        result.push(previousNode)
        continue
      }

      const created: Node<WorkflowNodeData> = {
        id: model.id,
        type: toCanvasNodeType(model.kind),
        position: model.position,
        draggable,
        data: { model, onOpen: handleOpenNode },
      }
      nextCache.set(model.id, created)
      result.push(created)
    }

    cachedNodesRef.current = nextCache
    return result
  }, [dockMode, dragEnabled, models, handleOpenNode])
  const flowEdges = useMemo(() => buildFlowEdges(models), [models])
  const selectedNode = useMemo(() => models.find(model => model.id === selectedNodeId) ?? null, [models, selectedNodeId])

  const updateNode = useCallback((nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => {
    setModels(current => current.map(node => (node.id === nodeId ? updater(node) : node)))
  }, [])

  useEffect(() => {
    if (hasFitViewRef.current || !models.length) return
    hasFitViewRef.current = true
    requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.2 })
    })
  }, [flow, models.length])

  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const updateCanvasHeight = () => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const bottomSpacing = 28
      const next = Math.max(420, Math.min(980, Math.floor(window.innerHeight - rect.top - bottomSpacing)))
      setCanvasHeight(next)
    }

    updateCanvasHeight()
    window.addEventListener('resize', updateCanvasHeight)

    const observer = new ResizeObserver(() => updateCanvasHeight())
    const element = canvasRef.current
    if (element?.parentElement) observer.observe(element.parentElement)

    return () => {
      window.removeEventListener('resize', updateCanvasHeight)
      observer.disconnect()
    }
  }, [])

  const rewireRemovedNode = useCallback((removedId: string) => {
    setModels(current => current.filter(node => node.id !== removedId).map(node => {
      if (node.kind === 'input' && node.next === removedId) return { ...node, next: 'output' }
      if (node.kind === 'condition') {
        return {
          ...node,
          nextTrue: node.nextTrue === removedId ? 'output' : node.nextTrue,
          nextFalse: node.nextFalse === removedId ? 'output' : node.nextFalse,
        }
      }
      if (node.kind !== 'output' && node.next === removedId) return { ...node, next: 'output' }
      return node
    }))
    setDrawerOpen(false)
    setSelectedNodeId(null)
  }, [])

  const appendNode = useCallback((position: { x: number; y: number }) => {
    const newNode = normalizeQueueNode(createNodeByKind(menuKind, position, 'output'))
    setModels(current => [...current, newNode])
    setContextMenu(null)
  }, [menuKind])

  const appendNote = useCallback((position: { x: number; y: number }) => {
    const newNote = normalizeQueueNode(createNodeByKind('note', position, 'output'))
    setModels(current => [...current, newNote])
    setContextMenu(null)
  }, [])

  const appendAtCanvasCenter = useCallback((kind: WorkflowNodeKind) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const position = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    if (kind === 'note') {
      appendNote(position)
      return
    }
    setMenuKind(kind)
    const newNode = normalizeQueueNode(createNodeByKind(kind, position, 'output'))
    setModels(current => [...current, newNode])
  }, [appendNote, flow])

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    updateNode(connection.source, node => {
      if (node.kind === 'condition' || node.kind === 'filter') {
        if (connection.sourceHandle === 'false') return { ...node, nextFalse: connection.target! }
        return { ...node, nextTrue: connection.target! }
      }
      if (node.kind === 'output') return node
      return { ...node, next: connection.target! }
    })
  }, [updateNode])

  const runLocalTest = useCallback(() => {
    try {
      const payload = JSON.parse(payloadText) as unknown
      setRunResult(runWorkflow(models, payload))
      setPayloadError('')
    } catch {
      setPayloadError('输入负载不是合法 JSON。')
    }
  }, [models, payloadText])

  const saveWorkflow = useCallback(() => {
    try {
      localStorage.setItem(workflowStorageKey, JSON.stringify(models))
      toast.success('流程已保存')
    } catch {
      toast.error('保存失败，请稍后重试')
    }
  }, [models, toast])

  const handleNodeDrag = useCallback((_event: React.MouseEvent, node: Node<WorkflowNodeData>) => {
    pendingDragRef.current = { id: node.id, position: node.position }
    if (dragRafRef.current !== null) return
    dragRafRef.current = requestAnimationFrame(() => {
      const pending = pendingDragRef.current
      dragRafRef.current = null
      if (!pending) return
      updateNode(pending.id, current => ({ ...current, position: pending.position }))
    })
  }, [updateNode])

  const handleNodeDragStop = useCallback((_event: React.MouseEvent, node: Node<WorkflowNodeData>) => {
    pendingDragRef.current = null
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }
    updateNode(node.id, current => ({ ...current, position: node.position }))
  }, [updateNode])

  return (
    <PageLayout>
      <PageHeader
        title="流程编排工作台"
        description="高保真原型：暗色菜单、节点概览、明确输入输出锚点、Drawer 详情配置"
        actions={(
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setTestDrawerOpen(true)
                runLocalTest()
              }}
            >
              <CirclePlay className="size-4" /> 测试运行
            </Button>
            <Button type="button" size="sm" onClick={saveWorkflow}>
              <Save className="size-4" /> 保存
            </Button>
          </div>
        )}
      />

      <PageContent>
        <Card>
          <CardContent>
            <div ref={canvasRef} className="relative w-full overflow-hidden rounded-xl bg-muted/30" style={{ height: `${canvasHeight}px` }}>
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                defaultEdgeOptions={defaultEdgeOptions}
                onlyRenderVisibleElements
                snapToGrid
                snapGrid={[16, 16]}
                nodeDragThreshold={1}
                nodesDraggable={dragEnabled && dockMode === 'select'}
                panOnDrag={dockMode === 'pan'}
                selectionOnDrag={dockMode === 'select'}
                onConnect={handleConnect}
                onPaneClick={() => setContextMenu(null)}
                onPaneContextMenu={event => {
                  event.preventDefault()
                  const rect = canvasRef.current?.getBoundingClientRect()
                  if (!rect) return
                  const menuPosition = computeContextMenuPosition(rect, event.clientX, event.clientY)
                  setContextMenu({
                    x: menuPosition.x,
                    y: menuPosition.y,
                    clientX: event.clientX,
                    clientY: event.clientY,
                  })
                }}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
                className="workflow-reactflow"
              >
                <Background gap={20} size={1} color="hsl(var(--muted-foreground) / 0.22)" />
                <Controls className="bg-card! ring-1! ring-foreground/10!" showInteractive={false} />
              </ReactFlow>

              {contextMenu && (
                <div
                  className="absolute z-20 w-44 rounded-lg bg-zinc-900 p-1.5 text-zinc-100 ring-1 ring-zinc-700"
                  style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                  <div className="mb-1 px-1.5 text-[11px] text-zinc-400">添加节点</div>
                  {[
                    { kind: 'condition' as const, label: '条件节点' },
                    { kind: 'filter' as const, label: '筛选节点' },
                    { kind: 'modifier' as const, label: '修改节点' },
                    { kind: 'json-edit' as const, label: 'JSON 修改' },
                    { kind: 'text-replace' as const, label: '文本替换' },
                    { kind: 'transformer' as const, label: '转换节点' },
                    { kind: 'note' as const, label: '备注节点' },
                    { kind: 'queue' as const, label: '队列节点' },
                  ].map(item => (
                    <button
                      key={item.kind}
                      type="button"
                      className="flex h-8 w-full items-center rounded-md px-2 text-left text-xs hover:bg-zinc-800"
                      onClick={() => {
                        setMenuKind(item.kind)
                        appendNode(flow.screenToFlowPosition({ x: contextMenu.clientX, y: contextMenu.clientY }))
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
                <div className="pointer-events-auto inline-flex max-w-full items-center gap-1 rounded-2xl border border-zinc-700/80 bg-zinc-900/94 p-1.5 text-zinc-100 shadow-lg shadow-black/20">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 rounded-lg text-zinc-100 hover:bg-zinc-800"
                    onClick={() => appendAtCanvasCenter(menuKind)}
                    aria-label="添加节点"
                  >
                    <Plus className="size-4" />
                  </Button>

                  <Select value={menuKind} onValueChange={value => setMenuKind(value as WorkflowNodeKind)}>
                    <SelectTrigger className="h-8 w-28 border-zinc-700 bg-zinc-900 text-xs text-zinc-100">
                      <SelectValue placeholder="节点类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="condition">条件节点</SelectItem>
                      <SelectItem value="filter">筛选节点</SelectItem>
                      <SelectItem value="modifier">修改节点</SelectItem>
                      <SelectItem value="json-edit">JSON 修改</SelectItem>
                      <SelectItem value="text-replace">文本替换</SelectItem>
                      <SelectItem value="transformer">转换节点</SelectItem>
                      <SelectItem value="queue">队列节点</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="mx-1 h-6 w-px bg-zinc-700" />

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 rounded-lg text-zinc-100 hover:bg-zinc-800"
                    onClick={() => appendAtCanvasCenter('note')}
                    aria-label="添加备注"
                  >
                    <StickyNote className="size-4" />
                  </Button>

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn('size-8 rounded-lg text-zinc-100 hover:bg-zinc-800', dockMode === 'select' && 'bg-blue-600 text-white hover:bg-blue-500')}
                    onClick={() => setDockMode('select')}
                    aria-label="选择模式"
                  >
                    <MousePointer2 className="size-4" />
                  </Button>

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn('size-8 rounded-lg text-zinc-100 hover:bg-zinc-800', dockMode === 'pan' && 'bg-blue-600 text-white hover:bg-blue-500')}
                    onClick={() => setDockMode('pan')}
                    aria-label="平移模式"
                  >
                    <Hand className="size-4" />
                  </Button>

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn('size-8 rounded-lg text-zinc-100 hover:bg-zinc-800', !dragEnabled && 'bg-zinc-800 text-zinc-300')}
                    onClick={() => setDragEnabled(value => !value)}
                    aria-label={dragEnabled ? '锁定拖拽' : '解锁拖拽'}
                  >
                    {dragEnabled ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                  </Button>

                  <div className="mx-1 h-6 w-px bg-zinc-700" />

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 rounded-lg text-zinc-100 hover:bg-zinc-800"
                    onClick={() => void flow.fitView({ padding: 0.2 })}
                    aria-label="适配视图"
                  >
                    <LocateFixed className="size-4" />
                  </Button>
                </div>
              </div>
          </div>
          </CardContent>
        </Card>
      </PageContent>

      <Drawer open={testDrawerOpen} onOpenChange={setTestDrawerOpen} direction="right">
        <DrawerContent className="h-full w-170 max-w-[95vw] border-l bg-popover">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2"><ArrowRight className="size-4" /> 测试运行</DrawerTitle>
            <DrawerDescription>在此输入 JSON，执行流程并查看结果与完整轨迹。</DrawerDescription>
          </DrawerHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 pb-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">测试输入</div>
              <Textarea value={payloadText} onChange={event => setPayloadText(event.target.value)} className="min-h-96 font-mono text-[12px]" />
              {payloadError && <div className="text-xs text-destructive">{payloadError}</div>}
            </div>

            <div className="min-h-0 space-y-3 overflow-y-auto">
              <div className="text-sm font-medium">测试结果</div>
              {!runResult && <div className="rounded-lg bg-muted/45 p-3 text-xs text-muted-foreground">点击下方“运行测试”查看结果。</div>}

              {runResult && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={runResult.targetQueue ? 'success' : 'muted'}>queue: {runResult.targetQueue ?? 'null'}</Badge>
                    <Badge variant="info">stop: {runResult.stopReason}</Badge>
                    <Badge variant="muted">steps: {runResult.trace.length}</Badge>
                  </div>
                  <div className="rounded-lg bg-muted/45 p-2 font-mono text-[11px]">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Output</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(runResult.outputPayload, null, 2)}</pre>
                  </div>
                  <div className="space-y-1.5 rounded-lg bg-muted/35 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Trace</div>
                    <div className="max-h-[45vh] space-y-1.5 overflow-y-auto">
                      {runResult.trace.map(item => (
                        <div key={`${item.nodeId}-${item.message}`} className="rounded-md bg-card/75 p-2 text-xs ring-1 ring-foreground/10">
                          <div className="mb-0.5 flex items-center gap-2">
                            <span className="font-medium">{item.nodeName}</span>
                            <Badge variant={item.success ? 'success' : 'warning'}>{item.kind}</Badge>
                          </div>
                          <div className="text-muted-foreground">{item.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <DrawerFooter>
            <Button type="button" onClick={runLocalTest}>运行测试</Button>
            <Button type="button" variant="outline" onClick={() => setTestDrawerOpen(false)}>关闭</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} direction="right">
        <DrawerContent className="h-full w-140 max-w-[92vw] border-l bg-popover">
          {!selectedNode && (
            <DrawerHeader>
              <DrawerTitle>未选中节点</DrawerTitle>
              <DrawerDescription>点击画布中的节点后，可在此查看详情并编辑配置。</DrawerDescription>
            </DrawerHeader>
          )}

          {selectedNode && (
            <>
              <DrawerHeader>
                <DrawerTitle>{selectedNode.name}</DrawerTitle>
                <DrawerDescription>{selectedNode.description}</DrawerDescription>
              </DrawerHeader>

              <div className="space-y-4 overflow-y-auto px-4 pb-4">
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label>节点类型</Label>
                    <Input value={kindLabel(selectedNode.kind)} disabled />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>节点名称</Label>
                    <Input value={selectedNode.name} onChange={event => updateNode(selectedNode.id, node => ({ ...node, name: event.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>节点说明</Label>
                    <Textarea value={selectedNode.description} onChange={event => updateNode(selectedNode.id, node => ({ ...node, description: event.target.value }))} className="min-h-20" />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted/45 px-3 py-2">
                    <span className="text-sm">启用节点</span>
                    <Switch
                      checked={selectedNode.enabled}
                      disabled={isFixedNode(selectedNode)}
                      onCheckedChange={checked => updateNode(selectedNode.id, node => ({ ...node, enabled: checked }))}
                    />
                  </div>
                </div>

                {selectedNode.kind === 'condition' && (
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label>字段路径</Label>
                      <Input value={selectedNode.path} onChange={event => updateNode(selectedNode.id, node => node.kind === 'condition' ? { ...node, path: event.target.value } : node)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1.5">
                        <Label>操作符</Label>
                        <Select value={selectedNode.operator} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'condition' ? { ...node, operator: value as typeof node.operator } : node)}>
                          <SelectTrigger className="w-full"><SelectValue placeholder="operator" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="contains">contains</SelectItem>
                            <SelectItem value="eq">eq</SelectItem>
                            <SelectItem value="neq">neq</SelectItem>
                            <SelectItem value="startsWith">startsWith</SelectItem>
                            <SelectItem value="regex">regex</SelectItem>
                            <SelectItem value="gt">gt</SelectItem>
                            <SelectItem value="exists">exists</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label>比较值</Label>
                        <Input
                          value={selectedNode.value}
                          disabled={selectedNode.operator === 'exists'}
                          placeholder={selectedNode.operator === 'exists' ? 'exists 不需要比较值' : undefined}
                          onChange={event => updateNode(selectedNode.id, node => node.kind === 'condition' ? { ...node, value: event.target.value } : node)}
                        />
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                      分支目标通过画布拖拽连线设置。
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'filter' && (
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label>筛选路径</Label>
                      <Input value={selectedNode.path} onChange={event => updateNode(selectedNode.id, node => node.kind === 'filter' ? { ...node, path: event.target.value } : node)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1.5">
                        <Label>筛选方式</Label>
                        <Select value={selectedNode.mode} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'filter' ? { ...node, mode: value as typeof node.mode } : node)}>
                          <SelectTrigger className="w-full"><SelectValue placeholder="mode" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="contains">contains</SelectItem>
                            <SelectItem value="eq">eq</SelectItem>
                            <SelectItem value="regex">regex</SelectItem>
                            <SelectItem value="in-list">in-list</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label>筛选值</Label>
                        <Input
                          value={selectedNode.value}
                          placeholder={selectedNode.mode === 'in-list' ? 'summarize,translate' : undefined}
                          onChange={event => updateNode(selectedNode.id, node => node.kind === 'filter' ? { ...node, value: event.target.value } : node)}
                        />
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                      true / false 分支仍通过画布连线设置。
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'modifier' && (
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label>写入路径</Label>
                      <Input value={selectedNode.path} onChange={event => updateNode(selectedNode.id, node => node.kind === 'modifier' ? { ...node, path: event.target.value } : node)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>写入值</Label>
                      <Input value={selectedNode.value} onChange={event => updateNode(selectedNode.id, node => node.kind === 'modifier' ? { ...node, value: event.target.value } : node)} />
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'json-edit' && (
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label>目标路径</Label>
                      <Input value={selectedNode.path} onChange={event => updateNode(selectedNode.id, node => node.kind === 'json-edit' ? { ...node, path: event.target.value } : node)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>操作</Label>
                      <Select value={selectedNode.operation} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'json-edit' ? { ...node, operation: value as typeof node.operation } : node)}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="operation" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="set">set</SelectItem>
                          <SelectItem value="remove">remove</SelectItem>
                          <SelectItem value="merge">merge</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedNode.operation !== 'remove' && (
                      <div className="grid gap-1.5">
                        <Label>值（支持 JSON）</Label>
                        <Textarea value={selectedNode.value} onChange={event => updateNode(selectedNode.id, node => node.kind === 'json-edit' ? { ...node, value: event.target.value } : node)} className="min-h-20" />
                      </div>
                    )}
                  </div>
                )}

                {selectedNode.kind === 'text-replace' && (
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label>目标路径</Label>
                      <Input value={selectedNode.path} onChange={event => updateNode(selectedNode.id, node => node.kind === 'text-replace' ? { ...node, path: event.target.value } : node)} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1.5">
                        <Label>查找</Label>
                        <Input value={selectedNode.search} onChange={event => updateNode(selectedNode.id, node => node.kind === 'text-replace' ? { ...node, search: event.target.value } : node)} />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>替换为</Label>
                        <Input value={selectedNode.replace} onChange={event => updateNode(selectedNode.id, node => node.kind === 'text-replace' ? { ...node, replace: event.target.value } : node)} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/45 px-3 py-2">
                      <span className="text-sm">启用正则</span>
                      <Switch
                        checked={selectedNode.useRegex}
                        onCheckedChange={checked => updateNode(selectedNode.id, node => node.kind === 'text-replace' ? { ...node, useRegex: checked } : node)}
                      />
                    </div>
                    {selectedNode.useRegex && (
                      <div className="grid gap-1.5">
                        <Label>正则 Flags</Label>
                        <Input value={selectedNode.regexFlags} onChange={event => updateNode(selectedNode.id, node => node.kind === 'text-replace' ? { ...node, regexFlags: event.target.value } : node)} placeholder="gim" />
                      </div>
                    )}
                  </div>
                )}

                {selectedNode.kind === 'note' && (
                  <div className="grid gap-1.5">
                    <Label>备注内容</Label>
                    <Textarea
                      value={selectedNode.content}
                      onChange={event => updateNode(selectedNode.id, node => node.kind === 'note' ? { ...node, content: event.target.value } : node)}
                      className="min-h-28"
                    />
                  </div>
                )}

                {selectedNode.kind === 'transformer' && (
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label>来源路径</Label>
                      <Input value={selectedNode.fromPath} onChange={event => updateNode(selectedNode.id, node => node.kind === 'transformer' ? { ...node, fromPath: event.target.value } : node)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>目标路径</Label>
                      <Input value={selectedNode.toPath} onChange={event => updateNode(selectedNode.id, node => node.kind === 'transformer' ? { ...node, toPath: event.target.value } : node)} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>转换方式</Label>
                      <Select value={selectedNode.mode} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'transformer' ? { ...node, mode: value as typeof node.mode } : node)}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="mode" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="trim">trim</SelectItem>
                          <SelectItem value="uppercase">uppercase</SelectItem>
                          <SelectItem value="lowercase">lowercase</SelectItem>
                          <SelectItem value="stringify">stringify</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'queue' && (
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label>默认目标队列</Label>
                      <Select value={selectedNode.queueId} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'queue' ? { ...node, queueId: value } : node)}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="queue" /></SelectTrigger>
                        <SelectContent>
                          {queueOptions.map(queue => <SelectItem key={queue} value={queue}>{queue}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>候选队列（逗号分隔）</Label>
                      <Input
                        value={(selectedNode.candidateQueues ?? [selectedNode.queueId]).join(',')}
                        placeholder="queue-vip-cn,queue-fallback"
                        onChange={event => updateNode(selectedNode.id, node => node.kind === 'queue'
                          ? { ...node, candidateQueues: event.target.value.split(',').map(item => item.trim()).filter(Boolean) }
                          : node)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1.5">
                        <Label>任务路径</Label>
                        <Input
                          value={selectedNode.taskPath ?? 'request.body.task'}
                          onChange={event => updateNode(selectedNode.id, node => node.kind === 'queue' ? { ...node, taskPath: event.target.value } : node)}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>任务筛选</Label>
                        <Select value={selectedNode.taskOperator ?? 'none'} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'queue' ? { ...node, taskOperator: value as typeof node.taskOperator } : node)}>
                          <SelectTrigger className="w-full"><SelectValue placeholder="taskOperator" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">none</SelectItem>
                            <SelectItem value="contains">contains</SelectItem>
                            <SelectItem value="eq">eq</SelectItem>
                            <SelectItem value="regex">regex</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {(selectedNode.taskOperator ?? 'none') !== 'none' && (
                      <div className="grid gap-1.5">
                        <Label>任务匹配值</Label>
                        <Input
                          value={selectedNode.taskValue ?? ''}
                          placeholder="summarize"
                          onChange={event => updateNode(selectedNode.id, node => node.kind === 'queue' ? { ...node, taskValue: event.target.value } : node)}
                        />
                      </div>
                    )}
                    <div className="grid gap-1.5">
                      <Label>任务不命中回退队列</Label>
                      <Select value={selectedNode.taskMissQueueId ?? selectedNode.queueId} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'queue' ? { ...node, taskMissQueueId: value } : node)}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="taskMissQueueId" /></SelectTrigger>
                        <SelectContent>
                          {queueOptions.map(queue => <SelectItem key={queue} value={queue}>{queue}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              <DrawerFooter>
                {!isFixedNode(selectedNode) && (
                  <Button type="button" variant="destructive" onClick={() => rewireRemovedNode(selectedNode.id)}>删除节点</Button>
                )}
                <Button type="button" variant="outline" onClick={() => setDrawerOpen(false)}>关闭</Button>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </PageLayout>
  )
}

export function WorkflowStudioPage() {
  return (
    <ReactFlowProvider>
      <WorkflowStudioCanvas />
    </ReactFlowProvider>
  )
}
