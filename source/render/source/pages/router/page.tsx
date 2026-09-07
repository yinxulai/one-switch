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
import {
  ArrowRight,
  ArrowRightLeft,
  Braces,
  CirclePlay,
  GitBranch,
  Hand,
  Lock,
  LockOpen,
  LocateFixed,
  MousePointer2,
  Plus,
  Save,
  Waypoints,
} from 'lucide-react'
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
import { useLogicalModels } from '@/features/logical-models/hooks'
import { cn } from '@/lib/utils'
import { unwrap } from '@/api/unwrap'
import { routerApi } from '@/api/router'
import {
  DEFAULT_OPERATOR_SET,
  type ConditionCase,
  type ConditionLogicalOperator,
  type ConditionRule,
  type ControlInputItem,
  type ControlInputKind,
  type ConditionOperator,
  type NodePosition,
  type SchemaValueType,
  type WorkflowProtocol,
  type WorkflowNodeKind,
  type WorkflowNodeModel,
  type WorkflowRunResult,
  type WorkflowGraph,
  type WorkflowEdge,
} from './types'
import { resolveInputHints, WORKFLOW_PROTOCOLS } from './field-hints'
import { WorkflowGraphSchema } from './schemas'

const routerStorageKey = 'one-switch.router.graph.v1'
const protocolOptions = WORKFLOW_PROTOCOLS
const routerLayoutOrder: WorkflowNodeKind[] = ['input', 'control-input', 'protocol-discovery', 'condition', 'queue-select', 'output']

function createConditionRule(): ConditionRule {
  return {
    fieldPath: 'request.body.tenant',
    valueType: 'string',
    operator: 'startsWith',
    value: 'vip-',
  }
}

function createConditionCase(): ConditionCase {
  return {
    id: createId('case'),
    name: '分支 1',
    logicalOperator: 'and',
    conditions: [createConditionRule()],
  }
}

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
      'x-provider': ['openai'],
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

function createDefaultGraph(): WorkflowGraph {
  const conditionCase = createConditionCase()
  const nodes: WorkflowNodeModel[] = [
    {
      id: 'input',
      kind: 'input',
      name: '输入请求',
      enabled: true,
      description: '固定入口节点：接收原始请求并开始路由。',
      position: { x: 120, y: 260 },
    },
    {
      id: 'protocol',
      kind: 'protocol-discovery',
      name: '协议发现',
      enabled: true,
      description: '输入 request，输出协议分支。',
      position: { x: 520, y: 260 },
    },
    {
      id: 'condition',
      kind: 'condition',
      name: '条件分支',
      enabled: true,
      description: '按类型感知条件执行 IF / ELSE 多分支。',
      position: { x: 920, y: 260 },
      cases: [conditionCase],
    },
    {
      id: 'output',
      kind: 'output',
      name: '路由结果出口',
      enabled: true,
      description: '固定出口节点：输出路由结果并交由代理执行。',
      position: { x: 1320, y: 260 },
      includeTrace: true,
      summaryLevel: 'detailed',
    },
  ]

  const edges: WorkflowEdge[] = [
    { id: 'edge-input-protocol', sourceNodeId: 'input', sourcePort: 'out', targetNodeId: 'protocol' },
    { id: 'edge-protocol-openai-completions', sourceNodeId: 'protocol', sourcePort: 'openai-completions', targetNodeId: 'condition' },
    { id: 'edge-protocol-openai-responses', sourceNodeId: 'protocol', sourcePort: 'openai-responses', targetNodeId: 'condition' },
    { id: 'edge-protocol-anthropic-messages', sourceNodeId: 'protocol', sourcePort: 'anthropic-messages', targetNodeId: 'condition' },
    { id: 'edge-protocol-unknown', sourceNodeId: 'protocol', sourcePort: 'unknown', targetNodeId: 'output' },
    { id: 'edge-condition-case', sourceNodeId: 'condition', sourcePort: conditionCase.id, targetNodeId: 'output' },
    { id: 'edge-condition-else', sourceNodeId: 'condition', sourcePort: 'else', targetNodeId: 'output' },
  ]

  return { version: 1, nodes, edges }
}

type WorkflowNodeData = {
  model: WorkflowNodeModel
  onOpen: (nodeId: string) => void
  onUpdateNode: (nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => void
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
  | 'queue-select'

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
  if (kind === 'queue-select') return '队列选择'
  return '输出'
}

function kindIcon(kind: WorkflowNodeKind) {
  if (kind === 'input') return CirclePlay
  if (kind === 'control-input') return ArrowRightLeft
  if (kind === 'output') return ArrowRight
  if (kind === 'protocol-discovery') return GitBranch
  if (kind === 'condition') return Waypoints
  if (kind === 'queue-select') return ArrowRightLeft
  return Braces
}

function kindTone(kind: WorkflowNodeKind): string {
  if (kind === 'input') return 'bg-info/14 text-info'
  if (kind === 'control-input') return 'bg-emerald-500/14 text-emerald-600 dark:text-emerald-400'
  if (kind === 'output') return 'bg-success/14 text-success-foreground'
  if (kind === 'protocol-discovery') return 'bg-cyan-500/12 text-cyan-500'
  if (kind === 'condition') return 'bg-warning/14 text-warning-foreground'
  if (kind === 'queue-select') return 'bg-violet-500/14 text-violet-500'
  return 'bg-primary/14 text-primary'
}

function modelSummary(model: WorkflowNodeModel): string {
  if (model.kind === 'input') return '接收请求并开始路由'
  if (model.kind === 'control-input') return `${model.controls.filter(control => control.enabled).length} 个控制项`
  if (model.kind === 'output') return '生成可用队列，交由代理执行'
  if (model.kind === 'protocol-discovery') return '自动识别协议并输出分支'
  if (model.kind === 'condition') return `${model.cases.length} 个分支 + ELSE`
  if (model.kind === 'queue-select') return `${model.queueIds.length} 个逻辑队列`
  return '生成可用队列，交由代理执行'
}

const fixedNodeCopy = {
  input: {
    name: '输入请求',
    description: '固定入口节点：接收原始请求并开始路由。',
  },
  output: {
    name: '路由结果出口',
    description: '固定出口节点：输出路由结果并交由代理执行。',
  },
} as const

function withFixedNodeCopy(nodes: WorkflowNodeModel[]): WorkflowNodeModel[] {
  let changed = false
  const next = nodes.map(node => {
    if (node.kind !== 'input' && node.kind !== 'output') return node
    const fixed = node.kind === 'input' ? fixedNodeCopy.input : fixedNodeCopy.output
    if (node.name === fixed.name && node.description === fixed.description) return node
    changed = true
    return { ...node, name: fixed.name, description: fixed.description }
  })
  return changed ? next : nodes
}

function isProtectedNode(model: WorkflowNodeModel): boolean {
  return model.kind === 'input' || model.kind === 'output'
}

const nodeHandleClass = 'size-3! border-0! bg-primary!'

const BaseNodeView = memo(function BaseNodeView(props: BaseNodeViewProps) {
  const { data } = props
  const model = data.model
  const KindIcon = kindIcon(model.kind)
  const enabledControls = model.kind === 'control-input'
    ? model.controls.filter(control => control.enabled)
    : []
  const protocolBranchLabels = model.kind === 'protocol-discovery'
    ? protocolOptions
    : []
  const conditionBranchCount = model.kind === 'condition' ? model.cases.length + 1 : 0
  const branchGap = conditionBranchCount > 6 ? 16 : 22
  const branchStartTop = 30
  const conditionBranchStartTop = 76
  const dynamicMinHeight = protocolBranchLabels.length > 0
    ? branchStartTop + (protocolBranchLabels.length - 1) * branchGap + 34
    : conditionBranchCount > 0
      ? conditionBranchStartTop + (conditionBranchCount - 1) * branchGap + 34
      : undefined

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => data.onOpen(model.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          data.onOpen(model.id)
        }
      }}
      style={dynamicMinHeight ? { minHeight: `${dynamicMinHeight}px` } : undefined}
      className={cn(
        'relative flex w-72 flex-col items-start justify-start overflow-visible rounded-xl bg-card px-3 py-2 text-left ring-1 ring-foreground/10 transition-colors hover:bg-card/85',
        !model.enabled && 'opacity-55',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('inline-flex size-5 items-center justify-center rounded-md', kindTone(model.kind))}>
          <KindIcon className="size-3.5" />
        </span>
        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', kindTone(model.kind))}>{kindLabel(model.kind)}</span>
      </div>
      <div className="truncate text-xs font-medium">{model.name}</div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">{modelSummary(model)}</div>

      {model.kind === 'control-input' && enabledControls.length > 0 && (
        <div className="mt-2 w-full space-y-1.5">
          {enabledControls.map(control => (
            <div key={control.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/45 py-1 pl-1.5 pr-2">
              <span className="truncate text-[10px] text-muted-foreground">{control.label}</span>

              {control.kind === 'switch' ? (
                <Switch
                  checked={Boolean(control.defaultValue)}
                  onClick={event => event.stopPropagation()}
                  onCheckedChange={checked => {
                    data.onUpdateNode(model.id, node => node.kind === 'control-input'
                      ? {
                        ...node,
                        controls: node.controls.map(item => item.id === control.id ? { ...item, defaultValue: checked } : item),
                      }
                      : node)
                  }}
                />
              ) : (
                <select
                  value={typeof control.defaultValue === 'string' ? control.defaultValue : (control.options?.[0]?.value ?? '')}
                  onClick={event => event.stopPropagation()}
                  onChange={event => {
                    const nextValue = event.target.value
                    data.onUpdateNode(model.id, node => node.kind === 'control-input'
                      ? {
                        ...node,
                        controls: node.controls.map(item => item.id === control.id ? { ...item, defaultValue: nextValue } : item),
                      }
                      : node)
                  }}
                  className="h-6 rounded border border-foreground/10 bg-background px-1.5 text-[10px] text-foreground outline-none"
                >
                  {(control.options ?? []).map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}

      {model.kind !== 'input' && (
        <>
          <Handle type="target" position={Position.Left} style={{ top: '50%', left: '-6px' }} className={nodeHandleClass} />
          <span className="pointer-events-none absolute -left-7 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">input</span>
        </>
      )}

      {model.kind === 'input' && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            style={{ top: 43, right: '-6px' }}
            className={nodeHandleClass}
          />
          <span
            className="pointer-events-none absolute -right-8 text-[10px] text-muted-foreground"
            style={{ top: model.kind === 'input' ? 37 : 'calc(50% - 6px)' }}
          >
            next
          </span>
        </>
      )}

      {model.kind === 'control-input' && (
        <>
          {enabledControls.map((control, index) => (
            <Handle key={control.id} id={control.id} type="source" position={Position.Right} style={{ top: 82 + index * 34, right: '-6px' }} className={nodeHandleClass} />
          ))}
          <Handle id="out" type="source" position={Position.Right} style={{ top: dynamicMinHeight ? dynamicMinHeight - 10 : '50%', right: '-6px' }} className={nodeHandleClass} />
          <span className="pointer-events-none absolute -right-10 text-[10px] text-primary" style={{ top: dynamicMinHeight ? dynamicMinHeight - 16 : 'calc(50% - 6px)' }}>继续</span>
        </>
      )}

      {model.kind === 'queue-select' && (
        <div className="mt-3 text-[11px] text-muted-foreground">
          {model.queueIds.length > 0 ? `已选择 ${model.queueIds.length} 个逻辑队列` : '尚未选择逻辑队列'}
        </div>
      )}

      {model.kind === 'condition' && (
        <>
          <div className="mt-3 w-full space-y-1">
            {model.cases.map(caseNode => (
              <div key={caseNode.id} className="flex h-5 items-center justify-end gap-1.5 pr-0.5 text-[10px] text-success" title={caseNode.name}>
                <span className="pointer-events-none max-w-44 truncate">{caseNode.name}</span>
              </div>
            ))}
            <div className="flex h-5 items-center justify-end gap-1.5 pr-0.5 text-[10px] text-warning">
              <span className="pointer-events-none">ELSE</span>
            </div>
          </div>
          {model.cases.map((caseNode, index) => (
            <Handle key={caseNode.id} id={caseNode.id} type="source" position={Position.Right} style={{ top: conditionBranchStartTop + index * branchGap, right: '-6px' }} className={nodeHandleClass} />
          ))}
          <Handle id="else" type="source" position={Position.Right} style={{ top: conditionBranchStartTop + model.cases.length * branchGap, right: '-6px' }} className={nodeHandleClass} />
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
                  style={{ top, right: '-6px' }}
                  className={nodeHandleClass}
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
    </div>
  )
})

const nodeTypes = {
  'route-input': BaseNodeView,
  'control-input': BaseNodeView,
  'route-output': BaseNodeView,
  'protocol-discovery': BaseNodeView,
  condition: BaseNodeView,
  'queue-select': BaseNodeView,
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

function buildFlowEdges(graph: WorkflowGraph): Edge[] {
  return graph.edges.map(edge => ({
    id: edge.id,
    source: edge.sourceNodeId,
    sourceHandle: edge.sourcePort === 'out' ? undefined : edge.sourcePort,
    target: edge.targetNodeId,
    animated: edge.sourcePort !== 'out' && edge.sourcePort !== 'else' && edge.sourcePort !== 'body',
  }))
}

function createNodeByKind(kind: Extract<WorkflowNodeKind, 'control-input' | 'protocol-discovery' | 'condition' | 'queue-select'>, position: NodePosition): WorkflowNodeModel {
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
    }
  }
  if (kind === 'protocol-discovery') {
    return {
      id,
      kind,
      name: '协议发现节点',
      enabled: true,
      description: '输入 request，输出协议分支。',
      position,
    }
  }
  if (kind === 'condition') {
    return {
      id,
      kind,
      name: '条件节点',
      enabled: true,
      description: '按类型感知条件做 IF / ELSE 多分支。',
      position,
      cases: [createConditionCase()],
    }
  }
  return {
    id,
    kind: 'queue-select',
    name: '队列选择节点',
    enabled: true,
    description: '选择一个或多个逻辑队列，交由出口执行。',
    position,
    queueIds: ['default'],
  }
}

function getOperatorsByType(type: SchemaValueType): ConditionOperator[] {
  return DEFAULT_OPERATOR_SET[type]
}

function WorkflowStudioCanvas() {
  const toast = useToast()
  const logicalModels = useLogicalModels()
  const flow = useReactFlow<Node<WorkflowNodeData>, Edge>()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const cachedNodesRef = useRef<Map<string, Node<WorkflowNodeData>>>(new Map())
  const hasFitViewRef = useRef(false)
  const dragRafRef = useRef<number | null>(null)
  const pendingDragRef = useRef<{ id: string; position: { x: number; y: number } } | null>(null)

  const [graph, setGraph] = useState<WorkflowGraph>(() => {
    try {
      const raw = localStorage.getItem(routerStorageKey)
      if (!raw) return createDefaultGraph()
      const parsed = JSON.parse(raw) as unknown
      const result = WorkflowGraphSchema.safeParse(parsed)
      if (!result.success) return createDefaultGraph()
      const hasInput = result.data.nodes.some(node => node.kind === 'input')
      const hasOutput = result.data.nodes.some(node => node.kind === 'output')
      return hasInput && hasOutput
        ? { ...result.data, nodes: withFixedNodeCopy(layoutRouterNodes(result.data.nodes)) }
        : createDefaultGraph()
    } catch {
      return createDefaultGraph()
    }
  })
  const models = graph.nodes

  const [dragEnabled, setDragEnabled] = useState(true)
  const [dockMode, setDockMode] = useState<'select' | 'pan'>('select')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  const [payloadText, setPayloadText] = useState(JSON.stringify(samplePayload, null, 2))
  const [payloadError, setPayloadError] = useState('')
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null)
  const [canvasHeight, setCanvasHeight] = useState(620)

  const selectedNode = useMemo(() => models.find(model => model.id === selectedNodeId) ?? null, [models, selectedNodeId])

  const updateNode = useCallback((nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => {
    setGraph(current => ({
      ...current,
      nodes: withFixedNodeCopy(current.nodes.map(node => (node.id === nodeId ? updater(node) : node))),
    }))
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
        data: { model, onOpen: handleOpenNode, onUpdateNode: updateNode },
      }
      nextCache.set(model.id, created)
      result.push(created)
    }

    cachedNodesRef.current = nextCache
    return result
  }, [dockMode, dragEnabled, handleOpenNode, models])

  const flowEdges = useMemo(() => buildFlowEdges(graph), [graph])

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
    setGraph(current => ({
      ...current,
      nodes: withFixedNodeCopy(current.nodes.filter(node => node.id !== removedId)),
      edges: current.edges
        .filter(edge => edge.sourceNodeId !== removedId && edge.targetNodeId !== removedId)
        .map(edge => edge.targetNodeId === removedId ? { ...edge, targetNodeId: 'output' } : edge),
    }))
    setDrawerOpen(false)
    setSelectedNodeId(null)
  }, [])

  const appendAtCanvasCenter = useCallback((kind: Extract<WorkflowNodeKind, 'control-input' | 'protocol-discovery' | 'condition' | 'queue-select'>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const position = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    const newNode = createNodeByKind(kind, position)
    setGraph(current => ({ ...current, nodes: withFixedNodeCopy([...current.nodes, newNode]) }))
  }, [flow])

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    const sourcePort = connection.sourceHandle ?? 'out'
    const edgeId = `${connection.source}:${sourcePort}->${connection.target}`
    setGraph(current => {
      const existing = current.edges.find(edge => edge.sourceNodeId === connection.source && edge.sourcePort === sourcePort)
      if (existing) {
        return {
          ...current,
          edges: current.edges.map(edge => edge.id === existing.id ? { ...edge, targetNodeId: connection.target! } : edge),
        }
      }
      return {
        ...current,
        edges: [...current.edges, { id: edgeId, sourceNodeId: connection.source, sourcePort, targetNodeId: connection.target! }],
      }
    })
  }, [])

  const runLocalTest = useCallback(async () => {
    try {
      const payload = JSON.parse(payloadText) as unknown
      const normalizedPayload = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
      normalizedPayload.queues = logicalModels.map(model => ({ id: model.id, name: model.name, enabled: model.enabled }))

      const result = await unwrap(routerApi.run(graph, normalizedPayload))
      setRunResult(result)
      setPayloadError('')
    } catch (error) {
      setRunResult(null)
      setPayloadError(error instanceof Error ? error.message : '输入负载不是合法 JSON。')
    }
  }, [graph, logicalModels, payloadText])

  const saveWorkflow = useCallback(() => {
    try {
      localStorage.setItem(routerStorageKey, JSON.stringify(graph))
      toast.success('路由已保存')
    } catch {
      toast.error('保存失败，请稍后重试')
    }
  }, [graph, toast])

  const conditionFieldHints = useMemo(() => {
    if (!selectedNode || selectedNode.kind !== 'condition') return []
    return resolveInputHints(graph, selectedNode.id, samplePayload).fields
  }, [graph, selectedNode])

  const conditionFieldType = useCallback((fieldPath: string, fallback: SchemaValueType): SchemaValueType => {
    return conditionFieldHints.find(item => item.path === fieldPath)?.valueType ?? fallback
  }, [conditionFieldHints])

  const conditionFieldIsAvailable = useCallback((fieldPath: string): boolean => {
    return conditionFieldHints.some(field => field.path === fieldPath)
  }, [conditionFieldHints])

  const currentConditionOperators = useCallback((fieldPath: string, fallback: SchemaValueType): ConditionOperator[] => {
    return getOperatorsByType(conditionFieldType(fieldPath, fallback))
  }, [conditionFieldType])

  const renderNodeHint = (node: WorkflowNodeModel): string => {
    if (node.kind === 'input') {
      return '输入节点无配置项，仅作为路由入口。'
    }
    if (node.kind === 'output') {
      return '输出节点无核心配置项，固定作为路由出口。Trace 与摘要仅影响调试可见性。'
    }
    if (node.kind === 'control-input') {
      return '控制输入节点会把开关、下拉等值写入 metadata.controls，供条件节点和其他逻辑引用。'
    }
    if (node.kind === 'protocol-discovery') {
      return '该节点无配置项，系统会自动分析请求并输出 openai-completions/openai-responses/anthropic-messages/unknown 分支。'
    }
    if (node.kind === 'condition') {
      return '字段来源于上游 schema，每个分支可包含多个条件，按 AND / OR 组合判定；首个命中的分支生效，否则走 ELSE。'
    }
    if (node.kind === 'queue-select') {
      return '从逻辑模型队列中选择一个或多个目标，作为路由出口的明确执行范围。'
    }
    return '该节点不会直接返回模型响应，而是返回一个可用队列交由代理执行。'
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
                <div className="pointer-events-auto inline-flex max-w-full items-center gap-1 rounded-2xl bg-popover/96 p-1.5 text-foreground ring-1 ring-foreground/10">
                  <div className="relative">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className={cn('size-8 rounded-lg text-foreground hover:bg-muted', addMenuOpen && 'bg-muted')}
                      aria-label="添加节点"
                      onClick={() => setAddMenuOpen(value => !value)}
                    >
                      <Plus className="size-4" />
                    </Button>

                    {addMenuOpen && (
                      <div className="absolute bottom-[calc(100%+0.5rem)] left-1/2 z-30 w-[20rem] -translate-x-1/2 rounded-xl bg-popover p-2 text-popover-foreground ring-1 ring-foreground/10">
                        <div className="grid gap-2.5">
                          <div className="space-y-1.5">
                            <div className="px-1 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">基础节点</div>
                            <div className="grid gap-1 pl-1">
                              <button type="button" className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted" onClick={() => { appendAtCanvasCenter('control-input'); setAddMenuOpen(false) }}>
                                <div className="flex size-5 items-center justify-center text-muted-foreground"><ArrowRightLeft className="size-3.5" /></div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs">控制输入</div>
                                  <div className="mt-0.5 text-[10px] text-muted-foreground">注入开关或选项</div>
                                </div>
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="px-1 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">路由节点</div>
                            <div className="grid gap-1 pl-1">
                              <button type="button" className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted" onClick={() => { appendAtCanvasCenter('protocol-discovery'); setAddMenuOpen(false) }}>
                                <div className="flex size-5 items-center justify-center text-muted-foreground"><GitBranch className="size-3.5" /></div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs">协议发现</div>
                                  <div className="mt-0.5 text-[10px] text-muted-foreground">识别协议并输出分支</div>
                                </div>
                              </button>
                              <button type="button" className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted" onClick={() => { appendAtCanvasCenter('condition'); setAddMenuOpen(false) }}>
                                <div className="flex size-5 items-center justify-center text-muted-foreground"><Waypoints className="size-3.5" /></div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs">条件</div>
                                  <div className="mt-0.5 text-[10px] text-muted-foreground">IF / ELSE 多分支判定</div>
                                </div>
                              </button>
                              <button type="button" className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted" onClick={() => { appendAtCanvasCenter('queue-select'); setAddMenuOpen(false) }}>
                                <div className="flex size-5 items-center justify-center text-muted-foreground"><ArrowRightLeft className="size-3.5" /></div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs">队列选择</div>
                                  <div className="mt-0.5 text-[10px] text-muted-foreground">选择一个或多个逻辑队列</div>
                                </div>
                              </button>
                            </div>
                          </div>

                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mx-1 h-6 w-px bg-muted" />

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn('size-8 rounded-lg text-foreground hover:bg-muted', dockMode === 'select' && 'bg-primary text-primary-foreground hover:bg-primary/90')}
                    onClick={() => setDockMode('select')}
                    aria-label="选择模式"
                  >
                    <MousePointer2 className="size-4" />
                  </Button>

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn('size-8 rounded-lg text-foreground hover:bg-muted', dockMode === 'pan' && 'bg-primary text-primary-foreground hover:bg-primary/90')}
                    onClick={() => setDockMode('pan')}
                    aria-label="平移模式"
                  >
                    <Hand className="size-4" />
                  </Button>

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className={cn('size-8 rounded-lg text-foreground hover:bg-muted', !dragEnabled && 'bg-muted text-muted-foreground')}
                    onClick={() => setDragEnabled(value => !value)}
                    aria-label={dragEnabled ? '锁定拖拽' : '解锁拖拽'}
                  >
                    {dragEnabled ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
                  </Button>

                  <div className="mx-1 h-6 w-px bg-muted" />

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 rounded-lg text-foreground hover:bg-muted"
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
        <DrawerContent className="h-full w-208! max-w-[90vw]! border-l bg-popover">
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
                    <Badge variant={runResult.stopReason === 'output' ? 'success' : 'warning'}>
                      路由状态：{runResult.stopReason === 'output' ? '已到达输出节点' : runResult.stopReason}
                    </Badge>
                    <Badge variant="info">协议：{runResult.protocol}</Badge>
                    <Badge variant="muted">节点数：{runResult.trace.length}</Badge>
                  </div>
                  <div className="rounded-lg bg-muted/45 p-2 font-mono text-[11px]">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">解析结果（调试详情）</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(runResult.queueSelections, null, 2)}</pre>
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

          <DrawerFooter className="flex-row justify-end">
            <Button type="button" onClick={runLocalTest}>运行测试</Button>
            <Button type="button" variant="outline" onClick={() => setTestDrawerOpen(false)}>关闭</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} direction="right">
        <DrawerContent className="h-full w-2xl! max-w-[88vw]! border-l bg-popover">
          {!selectedNode && (
            <DrawerHeader>
              <DrawerTitle>未选中节点</DrawerTitle>
              <DrawerDescription>点击画布中的节点后，可在此查看详情并编辑配置。</DrawerDescription>
            </DrawerHeader>
          )}

          {selectedNode && (
            <>
              <DrawerHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <DrawerTitle className="flex items-center gap-2">
                      {(() => {
                        const Icon = kindIcon(selectedNode.kind)
                        return <Icon className="size-4 shrink-0" />
                      })()}
                      {isProtectedNode(selectedNode)
                        ? <span>{selectedNode.name}</span>
                        : (
                          <Input
                            value={selectedNode.name}
                            onChange={event => updateNode(selectedNode.id, node => ({ ...node, name: event.target.value }))}
                            className="h-8"
                          />
                        )}
                    </DrawerTitle>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!isProtectedNode(selectedNode) && (
                      <Button type="button" size="sm" variant="destructive" onClick={() => rewireRemovedNode(selectedNode.id)}>删除节点</Button>
                    )}
                    <Button type="button" size="sm" variant="outline" onClick={() => setDrawerOpen(false)}>关闭</Button>
                  </div>
                </div>
              </DrawerHeader>

              <div className="space-y-3 overflow-y-auto px-3 pb-3">
                <div className="rounded-xl bg-muted/35 px-2.5 py-2 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">节点说明</div>
                  <div className="mt-1">{selectedNode.description}</div>
                  <div className="mt-1 text-muted-foreground/80">{renderNodeHint(selectedNode)}</div>
                </div>

                {selectedNode.kind === 'input' && (
                  <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                    输入节点无可配置项。
                  </div>
                )}

                {selectedNode.kind === 'control-input' && (
                  <div className="grid gap-2.5">
                    <div className="rounded-lg bg-muted/45 px-2.5 py-2 text-xs text-muted-foreground">
                      控制输入节点会把开关、下拉等值写入 metadata.controls，供条件节点直接引用。
                    </div>

                    <div className="grid gap-2.5">
                      {selectedNode.controls.map((control, index) => (
                        <div key={control.id} className="grid gap-2.5 rounded-lg bg-muted/35 p-2.5">
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
                  <div className="grid gap-2.5">
                    <div className="rounded-lg bg-muted/45 px-2.5 py-2 text-xs text-muted-foreground">
                      协议发现节点为零配置节点：系统自动根据 request.path、request.headers、request.body.model 识别协议。
                    </div>
                    <div className="rounded-lg bg-muted/45 px-2.5 py-2 text-xs text-muted-foreground">
                      协议分支输出口通过画布连线设置：openai-completions / openai-responses / anthropic-messages / unknown。
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'queue-select' && (
                  <div className="grid gap-2.5">
                    <div className="text-xs text-muted-foreground">队列选择节点只负责输出一个或多个逻辑队列，不内置任何路由策略。</div>
                    <div className="grid gap-1.5">
                      {logicalModels.map(model => (
                        <label key={model.id} className="flex items-center gap-2 rounded-lg bg-muted/35 px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selectedNode.queueIds.includes(model.id)}
                            onChange={event => updateNode(selectedNode.id, node => node.kind === 'queue-select'
                              ? { ...node, queueIds: event.target.checked ? [...new Set([...node.queueIds, model.id])] : node.queueIds.filter(id => id !== model.id) }
                              : node)}
                          />
                          <span className="min-w-0 flex-1 truncate">{model.name}</span>
                          <span className="text-xs text-muted-foreground">{model.id}</span>
                        </label>
                      ))}
                    </div>
                    {logicalModels.length === 0 && <div className="rounded-lg bg-warning/14 px-3 py-2 text-xs text-warning-foreground">暂无可用逻辑队列，请先在队列控制中创建。</div>}
                  </div>
                )}

                {selectedNode.kind === 'condition' && (
                  <div className="grid gap-3">
                    {conditionFieldHints.length === 0 && (
                      <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                        暂无可用字段，请先将会产生字段的节点连接到当前节点上游。
                      </div>
                    )}

                    {selectedNode.cases.map((caseNode, caseIndex) => (
                      <div key={caseNode.id} className="grid gap-3 rounded-lg bg-muted/35 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium">IF 分支 {caseIndex + 1}</div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={selectedNode.cases.length <= 1}
                            onClick={() => updateNode(selectedNode.id, node => node.kind === 'condition'
                              ? { ...node, cases: node.cases.filter(item => item.id !== caseNode.id) }
                              : node)}
                          >
                            删除分支
                          </Button>
                        </div>

                        <div className="grid gap-1.5">
                          <Label>分支名称</Label>
                          <Input
                            value={caseNode.name}
                            onChange={event => updateNode(selectedNode.id, node => node.kind === 'condition'
                              ? {
                                ...node,
                                cases: node.cases.map(item => item.id === caseNode.id ? { ...item, name: event.target.value } : item),
                              }
                              : node)}
                          />
                        </div>

                        <div className="grid gap-1.5">
                          <Label>条件组合方式</Label>
                          <Select
                            value={caseNode.logicalOperator}
                            onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'condition'
                              ? {
                                ...node,
                                cases: node.cases.map(item => item.id === caseNode.id ? { ...item, logicalOperator: value as ConditionLogicalOperator } : item),
                              }
                              : node)}
                          >
                            <SelectTrigger className="w-full"><SelectValue placeholder="logical operator" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="and">全部满足（AND）</SelectItem>
                              <SelectItem value="or">任一满足（OR）</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid gap-2">
                          {caseNode.conditions.map((rule, ruleIndex) => {
                            const available = conditionFieldIsAvailable(rule.fieldPath)
                            const fieldType = conditionFieldType(rule.fieldPath, rule.valueType)
                            const operators = currentConditionOperators(rule.fieldPath, rule.valueType)
                            return (
                              <div key={`${caseNode.id}-${ruleIndex}`} className="grid gap-2 rounded-lg bg-background/60 p-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-muted-foreground">条件 {ruleIndex + 1}</span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={caseNode.conditions.length <= 1}
                                    onClick={() => updateNode(selectedNode.id, node => node.kind === 'condition'
                                      ? {
                                        ...node,
                                        cases: node.cases.map(item => item.id === caseNode.id
                                          ? { ...item, conditions: item.conditions.filter((_, index) => index !== ruleIndex) }
                                          : item),
                                      }
                                      : node)}
                                  >
                                    删除
                                  </Button>
                                </div>

                                <div className="grid gap-1.5">
                                  <Label>字段路径（上游 schema）</Label>
                                  <Select
                                    value={rule.fieldPath}
                                    onValueChange={value => updateNode(selectedNode.id, node => {
                                      if (node.kind !== 'condition') return node
                                      const field = conditionFieldHints.find(item => item.path === value)
                                      const nextType = field?.valueType ?? rule.valueType
                                      return {
                                        ...node,
                                        cases: node.cases.map(item => item.id === caseNode.id
                                          ? {
                                            ...item,
                                            conditions: item.conditions.map((condition, index) => index === ruleIndex
                                              ? {
                                                ...condition,
                                                fieldPath: value,
                                                valueType: nextType,
                                                enumOptions: field?.enumOptions,
                                                operator: getOperatorsByType(nextType)[0] ?? 'equals',
                                              }
                                              : condition),
                                          }
                                          : item),
                                      }
                                    })}
                                  >
                                    <SelectTrigger className="w-full"><SelectValue placeholder="field path" /></SelectTrigger>
                                    <SelectContent>
                                      {conditionFieldHints.map(field => {
                                        const source = models.find(model => model.id === field.sourceNodeId)
                                        return (
                                          <SelectItem key={field.path} value={field.path}>
                                            {field.path} · {field.valueType} · {source?.name ?? field.sourceNodeId}
                                          </SelectItem>
                                        )
                                      })}
                                    </SelectContent>
                                  </Select>
                                  {!available && (
                                    <div className="rounded-lg bg-warning/14 px-3 py-2 text-xs text-warning-foreground">
                                      当前字段 {rule.fieldPath} 不再由任何已连接的上游节点提供。
                                    </div>
                                  )}
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div className="grid gap-1.5">
                                    <Label>字段类型</Label>
                                    <Input value={fieldType} disabled />
                                  </div>
                                  <div className="grid gap-1.5">
                                    <Label>操作符</Label>
                                    <Select
                                      value={rule.operator}
                                      onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'condition'
                                        ? {
                                          ...node,
                                          cases: node.cases.map(item => item.id === caseNode.id
                                            ? {
                                              ...item,
                                              conditions: item.conditions.map((condition, index) => index === ruleIndex
                                                ? { ...condition, operator: value as ConditionOperator }
                                                : condition),
                                            }
                                            : item),
                                        }
                                        : node)}
                                    >
                                      <SelectTrigger className="w-full"><SelectValue placeholder="operator" /></SelectTrigger>
                                      <SelectContent>
                                        {operators.map(operator => (
                                          <SelectItem key={operator} value={operator}>{operator}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>

                                {rule.operator !== 'exists' && rule.operator !== 'isTrue' && rule.operator !== 'isFalse' && rule.operator !== 'empty' && rule.operator !== 'notEmpty' && (
                                  <div className="grid gap-1.5">
                                    <Label>比较值</Label>
                                    <Input
                                      value={rule.value ?? ''}
                                      onChange={event => updateNode(selectedNode.id, node => node.kind === 'condition'
                                        ? {
                                          ...node,
                                          cases: node.cases.map(item => item.id === caseNode.id
                                            ? {
                                              ...item,
                                              conditions: item.conditions.map((condition, index) => index === ruleIndex
                                                ? { ...condition, value: event.target.value }
                                                : condition),
                                            }
                                            : item),
                                        }
                                        : node)}
                                    />
                                  </div>
                                )}

                                {rule.operator === 'between' && (
                                  <div className="grid gap-1.5">
                                    <Label>上界值</Label>
                                    <Input
                                      value={rule.secondaryValue ?? ''}
                                      onChange={event => updateNode(selectedNode.id, node => node.kind === 'condition'
                                        ? {
                                          ...node,
                                          cases: node.cases.map(item => item.id === caseNode.id
                                            ? {
                                              ...item,
                                              conditions: item.conditions.map((condition, index) => index === ruleIndex
                                                ? { ...condition, secondaryValue: event.target.value }
                                                : condition),
                                            }
                                            : item),
                                        }
                                        : node)}
                                    />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => updateNode(selectedNode.id, node => node.kind === 'condition'
                            ? {
                              ...node,
                              cases: node.cases.map(item => item.id === caseNode.id
                                ? { ...item, conditions: [...item.conditions, createConditionRule()] }
                                : item),
                            }
                            : node)}
                        >
                          添加条件
                        </Button>
                      </div>
                    ))}

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => updateNode(selectedNode.id, node => node.kind === 'condition'
                        ? { ...node, cases: [...node.cases, createConditionCase()] }
                        : node)}
                    >
                      添加 IF 分支
                    </Button>

                    <div className="rounded-lg bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                      每个分支与 ELSE 的目标节点通过画布连线设置；首个命中的分支生效，否则走 ELSE。
                    </div>
                  </div>
                )}

                {selectedNode.kind === 'output' && (
                  <div className="grid gap-2.5">
                    <div className="flex items-center justify-between rounded-lg bg-muted/45 px-2.5 py-2">
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
