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
import { ArrowRight, CirclePlay, Hand, Lock, LockOpen, LocateFixed, MousePointer2, Plus, Save } from 'lucide-react'
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
import { unwrap } from '@/api/unwrap'
import { routerApi } from '@/api/router'
import { logicalModelApi } from '@/api/models'
import {
  DEFAULT_OPERATOR_SET,
  type ControlInputItem,
  type ControlInputKind,
  type ConditionOperator,
  type ConfigHints,
  type NodePosition,
  type SchemaFieldDescriptor,
  type SchemaValueType,
  type WorkflowProtocol,
  type WorkflowNodeKind,
  type WorkflowNodeModel,
  type WorkflowRunResult,
} from './types'

const routerStorageKey = 'one-switch.router.models.v1'
const protocolOptions: WorkflowProtocol[] = ['openai-completions', 'openai-responses', 'anthropic-messages', 'unknown']
const routerLayoutOrder: WorkflowNodeKind[] = ['input', 'control-input', 'protocol-discovery', 'condition', 'logical-model-selector', 'output']

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
}

function createControlItem(kind: ControlInputKind): ControlInputItem {
  if (kind === 'switch') {
    return {
      id: createId('control'),
      key: 'featureEnabled',
      label: '功能开关',
      kind,
      enabled: true,
      defaultValue: true,
    }
  }

  return {
    id: createId('control'),
    key: 'routeMode',
    label: '路由模式',
    kind,
    enabled: true,
    defaultValue: 'balanced',
    options: [
      { label: 'Balanced', value: 'balanced' },
      { label: 'Fast', value: 'fast' },
      { label: 'Strict', value: 'strict' },
    ],
  }
}

function layoutRouterNodes(nodes: WorkflowNodeModel[]): WorkflowNodeModel[] {
  if (nodes.length <= 1) return nodes

  const positions = nodes.map(node => node.position)
  const minX = Math.min(...positions.map(position => position.x))
  const maxX = Math.max(...positions.map(position => position.x))
  const minY = Math.min(...positions.map(position => position.y))
  const maxY = Math.max(...positions.map(position => position.y))

  const clustered = (maxX - minX) < 180 && (maxY - minY) < 180
  if (!clustered) return nodes

  const nodesByKind = new Map<WorkflowNodeKind, WorkflowNodeModel[]>()
  for (const node of nodes) {
    const list = nodesByKind.get(node.kind) ?? []
    list.push(node)
    nodesByKind.set(node.kind, list)
  }

  const layoutMap = new Map<string, NodePosition>()
  const startX = 80
  const startY = 120
  const columnGap = 280
  const rowGap = 180

  routerLayoutOrder.forEach((kind, column) => {
    const list = nodesByKind.get(kind) ?? []
    list.forEach((node, row) => {
      layoutMap.set(node.id, {
        x: startX + column * columnGap,
        y: startY + row * rowGap,
      })
    })
  })

  return nodes.map(node => ({
    ...node,
    position: layoutMap.get(node.id) ?? node.position,
  }))
}

const samplePayload = {
  request: {
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'x-provider': 'openai',
      userAgent: 'OneSwitch/1.0',
    },
    body: {
      model: 'gpt-4o-mini',
      tenant: 'vip-cn',
      priority: 2,
      input: 'Summarize this article in Chinese.',
    },
  },
  metadata: { source: 'desktop-app' },
}

function createDefaultRouterModels(): WorkflowNodeModel[] {
  return [
    {
      id: 'input',
      kind: 'input',
      name: '输入',
      enabled: true,
      description: '路由入口节点。',
      position: { x: 120, y: 260 },
      next: 'logical-model-selector',
    },
    {
      id: 'logical-model-selector',
      kind: 'logical-model-selector',
      name: '模型匹配',
      enabled: true,
      description: '按请求 model 的 id/name 匹配逻辑模型，未命中回退 default。',
      position: { x: 520, y: 260 },
      logicalModelId: 'default',
      next: 'output',
    },
    {
      id: 'output',
      kind: 'output',
      name: '返回路由目标',
      enabled: true,
      description: '返回由逻辑模型解析出的可用队列，交由代理执行请求。',
      position: { x: 920, y: 260 },
      includeTrace: true,
      summaryLevel: 'detailed',
    },
  ]
}

type WorkflowNodeData = {
  model: WorkflowNodeModel
  onOpen: (nodeId: string) => void
}

type BaseNodeViewProps = {
  data: WorkflowNodeData
}

type WorkflowCanvasNodeType =
  | 'route-input'
  | 'control-input'
  | 'route-output'
  | 'protocol-discovery'
  | 'condition'
  | 'logical-model-selector'

function toCanvasNodeType(kind: WorkflowNodeKind): WorkflowCanvasNodeType {
  if (kind === 'input') return 'route-input'
  if (kind === 'control-input') return 'control-input'
  if (kind === 'output') return 'route-output'
  return kind
}

function kindLabel(kind: WorkflowNodeKind): string {
  if (kind === 'input') return '输入请求'
  if (kind === 'control-input') return '控制输入'
  if (kind === 'output') return '路由结果出口'
  if (kind === 'protocol-discovery') return '协议发现'
  if (kind === 'condition') return '条件'
  return '模型匹配'
}

function kindTone(kind: WorkflowNodeKind): string {
  if (kind === 'input') return 'bg-info/14 text-info'
  if (kind === 'control-input') return 'bg-emerald-500/14 text-emerald-600 dark:text-emerald-400'
  if (kind === 'output') return 'bg-success/14 text-success-foreground'
  if (kind === 'protocol-discovery') return 'bg-cyan-500/12 text-cyan-500'
  if (kind === 'condition') return 'bg-warning/14 text-warning-foreground'
  return 'bg-primary/14 text-primary'
}

function modelSummary(model: WorkflowNodeModel): string {
  if (model.kind === 'input') return '接收请求并开始路由'
  if (model.kind === 'control-input') return `${model.controls.filter(control => control.enabled).length} controls`
  if (model.kind === 'output') return '生成可用队列，交由代理执行'
  if (model.kind === 'protocol-discovery') return 'auto: path/header/model analysis'
  if (model.kind === 'condition') {
    return model.rule.operator === 'exists'
      ? `${model.rule.fieldPath} exists`
      : `${model.rule.fieldPath} ${model.rule.operator} ${model.rule.value ?? ''}`
  }
  return `按 model id/name 匹配，未命中 -> ${model.logicalModelId || 'default'}`
}

function isProtectedNode(model: WorkflowNodeModel): boolean {
  return model.kind === 'input' || model.kind === 'output'
}

function inferType(value: unknown): SchemaValueType {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'unknown'
}

function flattenFields(source: unknown, prefix: string, fields: SchemaFieldDescriptor[], sourceNodeId: string, sourcePort: string): void {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    if (prefix) {
      fields.push({
        path: prefix,
        valueType: inferType(source),
        sourceNodeId,
        sourcePort,
      })
    }
    return
  }

  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const nextPath = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenFields(value, nextPath, fields, sourceNodeId, sourcePort)
      continue
    }
    fields.push({
      path: nextPath,
      valueType: inferType(value),
      sourceNodeId,
      sourcePort,
    })
  }
}

function buildConfigHints(models: WorkflowNodeModel[]): ConfigHints {
  const fields: SchemaFieldDescriptor[] = []
  flattenFields(samplePayload, '', fields, 'input', 'context')
  fields.push({
    path: 'metadata.protocol',
    valueType: 'enum',
    sourceNodeId: 'protocol-discovery',
    sourcePort: 'protocol',
    enumOptions: protocolOptions,
  })
  fields.push({
    path: 'metadata.routeDecision.targetQueue',
    valueType: 'string',
    sourceNodeId: 'logical-model-selector',
    sourcePort: 'routeDecision',
  })

  for (const model of models) {
    if (model.kind !== 'control-input') continue
    for (const control of model.controls) {
      if (!control.enabled) continue
      fields.push({
        path: `metadata.controls.${control.key}`,
        valueType: control.kind === 'switch' ? 'boolean' : 'enum',
        sourceNodeId: model.id,
        sourcePort: control.id,
        enumOptions: control.kind === 'select' && control.options ? control.options.map(option => option.value) : undefined,
      })
    }
  }

  return {
    fields,
    recommendedOperators: DEFAULT_OPERATOR_SET,
  }
}

const BaseNodeView = memo(function BaseNodeView(props: BaseNodeViewProps) {
  const { data } = props
  const model = data.model
  const protocolBranchLabels = model.kind === 'protocol-discovery'
    ? protocolOptions
    : []
  const branchGap = 22
  const branchStartTop = 30
  const dynamicMinHeight = protocolBranchLabels.length > 0
    ? branchStartTop + (protocolBranchLabels.length - 1) * branchGap + 34
    : undefined

  return (
    <button
      type="button"
      onClick={() => data.onOpen(model.id)}
      style={dynamicMinHeight ? { minHeight: `${dynamicMinHeight}px` } : undefined}
      className={cn(
        'relative flex w-72 flex-col items-start justify-start overflow-visible rounded-xl bg-card px-3 py-2 text-left ring-1 ring-foreground/10 transition-colors hover:bg-card/85',
        !model.enabled && 'opacity-55',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', kindTone(model.kind))}>{kindLabel(model.kind)}</span>
      </div>
      <div className="truncate text-xs font-medium">{model.name}</div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">{modelSummary(model)}</div>

      {model.kind !== 'input' && (
        <>
          <Handle type="target" position={Position.Left} style={{ top: '50%' }} className="size-3! border-0! bg-info!" />
          <span className="pointer-events-none absolute -left-7 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">in</span>
        </>
      )}

      {(model.kind === 'input' || model.kind === 'control-input' || model.kind === 'logical-model-selector') && (
        <>
          <Handle type="source" position={Position.Right} style={{ top: '50%' }} className="size-3! border-0! bg-success!" />
          <span className="pointer-events-none absolute -right-8 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">out</span>
        </>
      )}

      {model.kind === 'logical-model-selector' && (
        <>
          <Handle type="source" position={Position.Right} style={{ top: '50%' }} className="size-3! border-0! bg-success!" />
          <span className="pointer-events-none absolute -right-8 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">out</span>
        </>
      )}

      {model.kind === 'condition' && (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: 30 }} className="size-3! border-0! bg-success!" />
          <Handle id="false" type="source" position={Position.Right} style={{ top: 56 }} className="size-3! border-0! bg-warning!" />
          <span className="pointer-events-none absolute -right-11 top-5 text-[10px] text-success">true</span>
          <span className="pointer-events-none absolute -right-12 top-12 text-[10px] text-warning">false</span>
        </>
      )}

      {model.kind === 'protocol-discovery' && (
        <>
          {protocolBranchLabels.map((label, index) => {
            const top = branchStartTop + index * branchGap
            const isUnknown = label === 'unknown'
            return (
              <div key={label}>
                <Handle
                  id={label}
                  type="source"
                  position={Position.Right}
                  style={{ top }}
                  className={cn('size-3! border-0!', isUnknown ? 'bg-warning!' : 'bg-success!')}
                />
                <span
                  className={cn('pointer-events-none absolute -right-20 text-[10px]', isUnknown ? 'text-warning' : 'text-muted-foreground')}
                  style={{ top: top - 6 }}
                >
                  {label}
                </span>
              </div>
            )
          })}
        </>
      )}
    </button>
  )
})

const nodeTypes = {
  'route-input': BaseNodeView,
  'control-input': BaseNodeView,
  'route-output': BaseNodeView,
  'protocol-discovery': BaseNodeView,
  condition: BaseNodeView,
  'logical-model-selector': BaseNodeView,
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

function buildFlowEdges(models: WorkflowNodeModel[]): Edge[] {
  const edges: Edge[] = []
  for (const model of models) {
    if (model.kind === 'output') continue
    if (model.kind === 'input' || model.kind === 'control-input' || model.kind === 'logical-model-selector') {
      edges.push({ id: `${model.id}->${model.next}`, source: model.id, target: model.next })
      continue
    }
    if (model.kind === 'condition') {
      edges.push({ id: `${model.id}:true->${model.nextTrue}`, source: model.id, sourceHandle: 'true', target: model.nextTrue, animated: true })
      edges.push({ id: `${model.id}:false->${model.nextFalse}`, source: model.id, sourceHandle: 'false', target: model.nextFalse })
      continue
    }

    const branches = model.branches
    for (const protocol of protocolOptions) {
      edges.push({
        id: `${model.id}:${protocol}->${branches[protocol]}`,
        source: model.id,
        sourceHandle: protocol,
        target: branches[protocol],
        animated: protocol !== 'unknown',
      })
    }
  }
  return edges
}

function createNodeByKind(kind: Extract<WorkflowNodeKind, 'control-input' | 'protocol-discovery' | 'condition' | 'logical-model-selector'>, position: NodePosition): WorkflowNodeModel {
  const id = `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
  if (kind === 'control-input') {
    return {
      id,
      kind,
      name: '控制输入节点',
      enabled: true,
      description: '注入开关与下拉等系统控制值。',
      position,
      controls: [createControlItem('switch')],
      next: 'protocol-discovery',
    }
  }
  if (kind === 'protocol-discovery') {
    return {
      id,
      kind,
      name: '协议发现节点',
      enabled: true,
      description: '新增协议识别分支。',
      position,
      branches: {
        'openai-completions': 'output',
        'openai-responses': 'output',
        'anthropic-messages': 'output',
        unknown: 'output',
      },
    }
  }
  if (kind === 'condition') {
    return {
      id,
      kind,
      name: '条件节点',
      enabled: true,
      description: '按类型感知条件做分支。',
      position,
      rule: {
        fieldPath: 'request.body.tenant',
        valueType: 'string',
        operator: 'startsWith',
        value: 'vip-',
      },
      nextTrue: 'output',
      nextFalse: 'output',
    }
  }
  return {
    id,
    kind,
    name: '解析路由目标',
    enabled: true,
    description: '匹配逻辑模型并准备生成可执行队列。',
    position,
    logicalModelId: 'default',
    next: 'output',
  }
}

function getOperatorsByType(type: SchemaValueType): ConditionOperator[] {
  return DEFAULT_OPERATOR_SET[type]
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
      const raw = localStorage.getItem(routerStorageKey)
      if (!raw) return createDefaultRouterModels()
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed) || parsed.length === 0) return createDefaultRouterModels()
      const hasInput = parsed.some(item => item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'input')
      const hasOutput = parsed.some(item => item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'output')
      return hasInput && hasOutput ? layoutRouterNodes(parsed as WorkflowNodeModel[]) : createDefaultRouterModels()
    } catch {
      return createDefaultRouterModels()
    }
  })

  const [dragEnabled, setDragEnabled] = useState(true)
  const [dockMode, setDockMode] = useState<'select' | 'pan'>('select')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [expandedAddGroup, setExpandedAddGroup] = useState<'基础节点' | '路由节点' | null>('路由节点')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  const [payloadText, setPayloadText] = useState(JSON.stringify(samplePayload, null, 2))
  const [payloadError, setPayloadError] = useState('')
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null)
  const [logicalModels, setLogicalModels] = useState<Array<{ id: string; name: string; enabled: boolean }>>([])
  const [canvasHeight, setCanvasHeight] = useState(620)

  const hints = useMemo(() => buildConfigHints(models), [models])

  useEffect(() => {
    let cancelled = false
    void unwrap(logicalModelApi.list()).then(items => {
      if (!cancelled) setLogicalModels(items.map(model => ({ id: model.id, name: model.name, enabled: model.enabled })))
    }).catch(() => {
      if (!cancelled) setLogicalModels([])
    })
    return () => { cancelled = true }
  }, [])

  const selectedNode = useMemo(() => models.find(model => model.id === selectedNodeId) ?? null, [models, selectedNodeId])

  const updateNode = useCallback((nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => {
    setModels(current => current.map(node => (node.id === nodeId ? updater(node) : node)))
  }, [])

  const handleOpenNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setDrawerOpen(true)
  }, [])

  const flowNodes = useMemo(() => {
    const previous = cachedNodesRef.current
    const nextCache = new Map<string, Node<WorkflowNodeData>>()
    const result: Node<WorkflowNodeData>[] = []

    for (const model of models) {
      const draggable = dragEnabled && dockMode === 'select'
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
  }, [dockMode, dragEnabled, handleOpenNode, models])

  const flowEdges = useMemo(() => buildFlowEdges(models), [models])

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
      const next = Math.max(420, Math.floor(window.innerHeight - rect.top - bottomSpacing))
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

  const handleNodeDrag = useCallback<NonNullable<React.ComponentProps<typeof ReactFlow<Node<WorkflowNodeData>, Edge>>['onNodeDrag']>>((_event, node) => {
    pendingDragRef.current = { id: node.id, position: node.position }
    if (dragRafRef.current !== null) return
    dragRafRef.current = requestAnimationFrame(() => {
      const pending = pendingDragRef.current
      dragRafRef.current = null
      if (!pending) return
      updateNode(pending.id, current => ({ ...current, position: pending.position }))
    })
  }, [updateNode])

  const handleNodeDragStop = useCallback<NonNullable<React.ComponentProps<typeof ReactFlow<Node<WorkflowNodeData>, Edge>>['onNodeDragStop']>>((_event, node) => {
    pendingDragRef.current = null
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }
    updateNode(node.id, current => ({ ...current, position: node.position }))
  }, [updateNode])

  const rewireRemovedNode = useCallback((removedId: string) => {
    setModels(current => current.filter(node => node.id !== removedId).map(node => {
      if (node.kind === 'input' && node.next === removedId) return { ...node, next: 'output' }
      if (node.kind === 'control-input' && node.next === removedId) return { ...node, next: 'output' }
      if (node.kind === 'condition') {
        return {
          ...node,
          nextTrue: node.nextTrue === removedId ? 'output' : node.nextTrue,
          nextFalse: node.nextFalse === removedId ? 'output' : node.nextFalse,
        }
      }
      if (node.kind === 'protocol-discovery') {
        return {
          ...node,
          branches: {
            'openai-completions': node.branches['openai-completions'] === removedId ? 'output' : node.branches['openai-completions'],
            'openai-responses': node.branches['openai-responses'] === removedId ? 'output' : node.branches['openai-responses'],
            'anthropic-messages': node.branches['anthropic-messages'] === removedId ? 'output' : node.branches['anthropic-messages'],
            unknown: node.branches.unknown === removedId ? 'output' : node.branches.unknown,
          },
        }
      }
      if (node.kind === 'logical-model-selector' && node.next === removedId) {
        return { ...node, next: 'output' }
      }
      return node
    }))
    setDrawerOpen(false)
    setSelectedNodeId(null)
  }, [])

  const appendAtCanvasCenter = useCallback((kind: Extract<WorkflowNodeKind, 'control-input' | 'protocol-discovery' | 'condition' | 'logical-model-selector'>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const position = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    const newNode = createNodeByKind(kind, position)
    setModels(current => [...current, newNode])
  }, [flow])

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    updateNode(connection.source, node => {
      if (node.kind === 'condition') {
        if (connection.sourceHandle === 'false') return { ...node, nextFalse: connection.target }
        return { ...node, nextTrue: connection.target }
      }
      if (node.kind === 'protocol-discovery') {
        const handle = connection.sourceHandle as WorkflowProtocol | null
        if (!handle || !protocolOptions.includes(handle)) return node
        return {
          ...node,
          branches: {
            ...node.branches,
            [handle]: connection.target,
          },
        }
      }
      if (node.kind === 'input' || node.kind === 'control-input' || node.kind === 'logical-model-selector') {
        return { ...node, next: connection.target }
      }
      return node
    })
  }, [updateNode])

  const runLocalTest = useCallback(async () => {
    try {
      const payload = JSON.parse(payloadText) as unknown
      const result = await unwrap(routerApi.run(models, payload))
      setRunResult(result)
      setPayloadError('')
    } catch (error) {
      setRunResult(null)
      setPayloadError(error instanceof Error ? error.message : '输入负载不是合法 JSON。')
    }
  }, [models, payloadText])

  const saveWorkflow = useCallback(() => {
    try {
      localStorage.setItem(routerStorageKey, JSON.stringify(models))
      toast.success('路由已保存')
    } catch {
      toast.error('保存失败，请稍后重试')
    }
  }, [models, toast])

  const conditionFieldHints = useMemo(() => {
    if (!selectedNode || selectedNode.kind !== 'condition') return []
    return hints.fields
  }, [hints.fields, selectedNode])

  const selectedConditionFieldType = useMemo((): SchemaValueType => {
    if (!selectedNode || selectedNode.kind !== 'condition') return 'unknown'
    const hit = conditionFieldHints.find(item => item.path === selectedNode.rule.fieldPath)
    return hit?.valueType ?? selectedNode.rule.valueType
  }, [conditionFieldHints, selectedNode])

  const currentConditionOperators = useMemo(() => {
    return getOperatorsByType(selectedConditionFieldType)
  }, [selectedConditionFieldType])

  const renderNodeHint = (node: WorkflowNodeModel): string => {
    if (node.kind === 'input') {
      return '输入节点无配置项，仅作为路由入口。'
    }
    if (node.kind === 'control-input') {
      return '控制输入节点会把开关、下拉等值写入 metadata.controls，供条件节点和其他逻辑引用。'
    }
    if (node.kind === 'protocol-discovery') {
      return '该节点无配置项，系统会自动分析请求并输出 openai-completions/openai-responses/anthropic-messages/unknown 分支。'
    }
    if (node.kind === 'condition') {
      return '字段来源于上游 schema，操作符与输入控件应由字段类型自动驱动。'
    }
    if (node.kind === 'logical-model-selector') {
      return '匹配请求中的 model 与逻辑模型；匹配完成后，系统会解析出可供代理执行的队列。'
    }
    return '该节点不会直接返回模型响应，而是返回一个可用队列交由代理执行。Trace 和摘要级别仅用于调试与观测。'
  }

  return (
    <PageLayout>
      <PageHeader
        title="Router"
        description="Router 页面：核心 5 节点、协议分支端口、类型感知配置体验"
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
        <Card className="w-full">
          <CardContent>
            <div ref={canvasRef} className="relative w-full overflow-hidden rounded-xl bg-muted/30" style={{ height: `${canvasHeight}px` }}>
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                defaultEdgeOptions={defaultEdgeOptions}
                proOptions={{ hideAttribution: true }}
                onlyRenderVisibleElements
                snapToGrid
                snapGrid={[16, 16]}
                nodeDragThreshold={1}
                nodesDraggable={dragEnabled && dockMode === 'select'}
                panOnDrag={dockMode === 'pan'}
                selectionOnDrag={dockMode === 'select'}
                onConnect={handleConnect}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
                className="workflow-reactflow"
              >
                <Background gap={20} size={1} color="hsl(var(--muted-foreground) / 0.22)" />
                <Controls className="router-controls" showInteractive={false} />
              </ReactFlow>

              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
                <div className="pointer-events-auto inline-flex max-w-full items-center gap-1 rounded-2xl border border-zinc-700/80 bg-zinc-900/94 p-1.5 text-zinc-100 shadow-lg shadow-black/20">
                  <div className="relative">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={cn('size-8 rounded-lg text-zinc-100 hover:bg-zinc-800', addMenuOpen && 'bg-zinc-800')}
                      aria-label="添加节点"
                      onClick={() => setAddMenuOpen(value => !value)}
                    >
                      <Plus className="size-4" />
                    </Button>

                    {addMenuOpen && (
                      <div className="absolute bottom-[calc(100%+0.5rem)] left-1/2 w-64 -translate-x-1/2 rounded-xl border border-zinc-700/80 bg-zinc-900 p-2 text-zinc-100 shadow-xl shadow-black/30">
                        <div className="grid gap-2">
                          <button
                            type="button"
                            className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-800"
                            onClick={() => setExpandedAddGroup(current => current === '基础节点' ? null : '基础节点')}
                          >
                            <span>基础节点</span>
                            <span className="text-xs text-zinc-400">{expandedAddGroup === '基础节点' ? '收起' : '展开'}</span>
                          </button>
                          {expandedAddGroup === '基础节点' && (
                            <div className="grid gap-1 pl-2">
                              <button type="button" className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-800" onClick={() => { appendAtCanvasCenter('control-input'); setAddMenuOpen(false) }}>控制输入</button>
                            </div>
                          )}

                          <button
                            type="button"
                            className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-800"
                            onClick={() => setExpandedAddGroup(current => current === '路由节点' ? null : '路由节点')}
                          >
                            <span>路由节点</span>
                            <span className="text-xs text-zinc-400">{expandedAddGroup === '路由节点' ? '收起' : '展开'}</span>
                          </button>
                          {expandedAddGroup === '路由节点' && (
                            <div className="grid gap-1 pl-2">
                              <button type="button" className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-800" onClick={() => { appendAtCanvasCenter('protocol-discovery'); setAddMenuOpen(false) }}>协议发现</button>
                              <button type="button" className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-800" onClick={() => { appendAtCanvasCenter('condition'); setAddMenuOpen(false) }}>条件</button>
                              <button type="button" className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-800" onClick={() => { appendAtCanvasCenter('logical-model-selector'); setAddMenuOpen(false) }}>模型选择器</button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mx-1 h-6 w-px bg-zinc-700" />

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
            <DrawerDescription>在此输入 JSON，执行路由并查看结果与完整轨迹。</DrawerDescription>
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
                    <Badge variant={runResult.targetQueue ? 'success' : 'warning'}>
                      {runResult.targetQueue ? '路由状态：已生成可用队列' : '路由状态：无法生成队列'}
                    </Badge>
                    <Badge variant={runResult.targetQueue ? 'success' : 'muted'}>目标队列：{runResult.targetQueue ?? '未生成'}</Badge>
                    <Badge variant="info">协议：{runResult.protocol}</Badge>
                    <Badge variant="muted">节点数：{runResult.trace.length}</Badge>
                  </div>
                  <div className="rounded-lg bg-muted/45 p-2 font-mono text-[11px]">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">路由决策（调试详情）</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(runResult.routeDecision, null, 2)}</pre>
                  </div>
                  <div className="rounded-lg bg-muted/45 p-2 font-mono text-[11px]">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Output</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(runResult.outputPayload, null, 2)}</pre>
                  </div>
                  <div className="space-y-1.5 rounded-lg bg-muted/35 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Trace</div>
                    <div className="max-h-[40vh] space-y-1.5 overflow-y-auto">
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
                    <Input value={selectedNode.name} disabled={selectedNode.kind === 'input'} onChange={event => updateNode(selectedNode.id, node => ({ ...node, name: event.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>节点说明</Label>
                    <Textarea value={selectedNode.description} disabled={selectedNode.kind === 'input'} onChange={event => updateNode(selectedNode.id, node => ({ ...node, description: event.target.value }))} className="min-h-20" />
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted/45 px-3 py-2">
                    <span className="text-sm">启用节点</span>
                    <Switch
                      checked={selectedNode.enabled}
                      disabled={selectedNode.kind === 'input'}
                      onCheckedChange={checked => updateNode(selectedNode.id, node => ({ ...node, enabled: checked }))}
                    />
                  </div>
                </div>

                <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">配置提示</div>
                  <div className="mt-1">{renderNodeHint(selectedNode)}</div>
                </div>

                {selectedNode.kind === 'input' && (
                  <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                    输入节点无可配置项。
                  </div>
                )}

                {selectedNode.kind === 'control-input' && (
                  <div className="grid gap-3">
                    <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                      控制输入节点会把开关、下拉等值写入 metadata.controls，供条件节点直接引用。
                    </div>

                    <div className="grid gap-3">
                      {selectedNode.controls.map((control, index) => (
                        <div key={control.id} className="grid gap-3 rounded-lg bg-muted/35 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium">控制项 {index + 1}</div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => updateNode(selectedNode.id, node => node.kind === 'control-input'
                                ? { ...node, controls: node.controls.filter(item => item.id !== control.id) }
                                : node)}
                            >
                              删除
                            </Button>
                          </div>

                          <div className="grid gap-1.5">
                            <Label>键名</Label>
                            <Input
                              value={control.key}
                              onChange={event => updateNode(selectedNode.id, node => node.kind === 'control-input'
                                ? {
                                  ...node,
                                  controls: node.controls.map(item => item.id === control.id ? { ...item, key: event.target.value } : item),
                                }
                                : node)}
                            />
                          </div>

                          <div className="grid gap-1.5">
                            <Label>名称</Label>
                            <Input
                              value={control.label}
                              onChange={event => updateNode(selectedNode.id, node => node.kind === 'control-input'
                                ? {
                                  ...node,
                                  controls: node.controls.map(item => item.id === control.id ? { ...item, label: event.target.value } : item),
                                }
                                : node)}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="grid gap-1.5">
                              <Label>类型</Label>
                              <Select
                                value={control.kind}
                                onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'control-input'
                                  ? {
                                    ...node,
                                    controls: node.controls.map(item => {
                                      if (item.id !== control.id) return item
                                      if (value === 'switch') {
                                        return {
                                          ...item,
                                          kind: 'switch',
                                          defaultValue: typeof item.defaultValue === 'boolean' ? item.defaultValue : true,
                                          options: undefined,
                                        }
                                      }
                                      return {
                                        ...item,
                                        kind: 'select',
                                        defaultValue: typeof item.defaultValue === 'string' ? item.defaultValue : (item.options?.[0]?.value ?? 'balanced'),
                                        options: item.options?.length ? item.options : [
                                          { label: 'Balanced', value: 'balanced' },
                                          { label: 'Fast', value: 'fast' },
                                        ],
                                      }
                                    }),
                                  }
                                  : node)}
                              >
                                <SelectTrigger className="w-full"><SelectValue placeholder="type" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="switch">开关</SelectItem>
                                  <SelectItem value="select">下拉</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-center justify-between rounded-lg bg-background/60 px-3 py-2">
                              <span className="text-sm">启用</span>
                              <Switch
                                checked={control.enabled}
                                onCheckedChange={checked => updateNode(selectedNode.id, node => node.kind === 'control-input'
                                  ? {
                                    ...node,
                                    controls: node.controls.map(item => item.id === control.id ? { ...item, enabled: checked } : item),
                                  }
                                  : node)}
                              />
                            </div>
                          </div>

                          {control.kind === 'switch' && (
                            <div className="flex items-center justify-between rounded-lg bg-background/60 px-3 py-2">
                              <span className="text-sm">默认开启</span>
                              <Switch
                                checked={Boolean(control.defaultValue)}
                                onCheckedChange={checked => updateNode(selectedNode.id, node => node.kind === 'control-input'
                                  ? {
                                    ...node,
                                    controls: node.controls.map(item => item.id === control.id ? { ...item, defaultValue: checked } : item),
                                  }
                                  : node)}
                              />
                            </div>
                          )}

                          {control.kind === 'select' && (
                            <div className="grid gap-3">
                              <div className="grid gap-1.5">
                                <Label>默认值</Label>
                                <Select
                                  value={typeof control.defaultValue === 'string' ? control.defaultValue : (control.options?.[0]?.value ?? '')}
                                  onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'control-input'
                                    ? {
                                      ...node,
                                      controls: node.controls.map(item => item.id === control.id ? { ...item, defaultValue: value } : item),
                                    }
                                    : node)}
                                >
                                  <SelectTrigger className="w-full"><SelectValue placeholder="default" /></SelectTrigger>
                                  <SelectContent>
                                    {(control.options ?? []).map(option => (
                                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="grid gap-1.5">
                                <Label>下拉选项（每行一个）</Label>
                                <Textarea
                                  value={(control.options ?? []).map(option => option.value).join('\n')}
                                  onChange={event => updateNode(selectedNode.id, node => node.kind === 'control-input'
                                    ? {
                                      ...node,
                                      controls: node.controls.map(item => item.id === control.id
                                        ? {
                                          ...item,
                                          options: event.target.value.split('\n').map(option => option.trim()).filter(Boolean).map(option => ({ label: option, value: option })),
                                          defaultValue: event.target.value.split('\n').map(option => option.trim()).filter(Boolean)[0] ?? '',
                                        }
                                        : item),
                                    }
                                    : node)}
                                  className="min-h-24"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => updateNode(selectedNode.id, node => node.kind === 'control-input'
                        ? { ...node, controls: [...node.controls, createControlItem('switch')] }
                        : node)}
                    >
                      添加控制项
                    </Button>
                  </div>
                )}

                {selectedNode.kind === 'protocol-discovery' && (
                  <div className="grid gap-3">
                    <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                      协议发现节点为零配置节点：系统自动根据 request.path、request.headers、request.body.model 识别协议。
                    </div>
                    <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                      协议分支输出口通过画布连线设置：openai-completions / openai-responses / anthropic-messages / unknown。
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'condition' && (
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label>字段路径（上游 schema）</Label>
                      <Select
                        value={selectedNode.rule.fieldPath}
                        onValueChange={value => updateNode(selectedNode.id, node => {
                          if (node.kind !== 'condition') return node
                          const field = hints.fields.find(item => item.path === value)
                          return {
                            ...node,
                            rule: {
                              ...node.rule,
                              fieldPath: value,
                              valueType: field?.valueType ?? node.rule.valueType,
                              enumOptions: field?.enumOptions,
                              operator: getOperatorsByType(field?.valueType ?? node.rule.valueType)[0] ?? 'equals',
                            },
                          }
                        })}
                      >
                        <SelectTrigger className="w-full"><SelectValue placeholder="field path" /></SelectTrigger>
                        <SelectContent>
                          {conditionFieldHints.map(field => (
                            <SelectItem key={field.path} value={field.path}>{field.path}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1.5">
                        <Label>字段类型</Label>
                        <Input value={selectedConditionFieldType} disabled />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>操作符</Label>
                        <Select
                          value={selectedNode.rule.operator}
                          onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'condition'
                            ? {
                              ...node,
                              rule: {
                                ...node.rule,
                                operator: value as ConditionOperator,
                              },
                            }
                            : node)}
                        >
                          <SelectTrigger className="w-full"><SelectValue placeholder="operator" /></SelectTrigger>
                          <SelectContent>
                            {currentConditionOperators.map(operator => (
                              <SelectItem key={operator} value={operator}>{operator}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {selectedNode.rule.operator !== 'exists' && selectedNode.rule.operator !== 'isTrue' && selectedNode.rule.operator !== 'isFalse' && (
                      <div className="grid gap-1.5">
                        <Label>比较值</Label>
                        <Input
                          value={selectedNode.rule.value ?? ''}
                          onChange={event => updateNode(selectedNode.id, node => node.kind === 'condition'
                            ? {
                              ...node,
                              rule: {
                                ...node.rule,
                                value: event.target.value,
                              },
                            }
                            : node)}
                        />
                      </div>
                    )}

                    {selectedNode.rule.operator === 'between' && (
                      <div className="grid gap-1.5">
                        <Label>上界值</Label>
                        <Input
                          value={selectedNode.rule.secondaryValue ?? ''}
                          onChange={event => updateNode(selectedNode.id, node => node.kind === 'condition'
                            ? {
                              ...node,
                              rule: {
                                ...node.rule,
                                secondaryValue: event.target.value,
                              },
                            }
                            : node)}
                        />
                      </div>
                    )}

                    <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                      分支目标通过画布连线设置（true / false）。
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'logical-model-selector' && (
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label>逻辑模型</Label>
                      <Select value={selectedNode.logicalModelId} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'logical-model-selector' ? { ...node, logicalModelId: value } : node)}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="logicalModelId" /></SelectTrigger>
                        <SelectContent>
                          {logicalModels.filter(item => item.enabled).map(item => (
                            <SelectItem key={item.id} value={item.id}>{item.name} ({item.id})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                      请求体中的 model 会按逻辑模型 id/name 自动匹配；未命中时回退到 default。匹配完成后，系统会解析出可供代理执行的目标队列。
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'output' && (
                  <div className="grid gap-3">
                    <div className="flex items-center justify-between rounded-lg bg-muted/45 px-3 py-2">
                      <span className="text-sm">附带完整 Trace</span>
                      <Switch
                        checked={selectedNode.includeTrace}
                        onCheckedChange={checked => updateNode(selectedNode.id, node => node.kind === 'output' ? { ...node, includeTrace: checked } : node)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>摘要级别</Label>
                      <Select value={selectedNode.summaryLevel} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'output' ? { ...node, summaryLevel: value as 'brief' | 'detailed' } : node)}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="summary" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="brief">简要</SelectItem>
                          <SelectItem value="detailed">详细</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>

              <DrawerFooter>
                {!isProtectedNode(selectedNode) && (
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

export function RouterPage() {
  return (
    <ReactFlowProvider>
      <WorkflowStudioCanvas />
    </ReactFlowProvider>
  )
}
