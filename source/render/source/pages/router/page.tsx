import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Connection,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowRight,
  CirclePlay,
  Hand,
  Lock,
  LockOpen,
  LocateFixed,
  MousePointer2,
  Plus,
  Save,
} from 'lucide-react'

import { routerApi } from '@/api/router'
import { unwrap } from '@/api/unwrap'
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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useLogicalModels } from '@/features/logical-models/hooks'
import { cn } from '@/lib/utils'

import { NodeSelector } from './components/node-selector'
import { WorkflowConnectionLine } from './components/workflow-connection-line'
import { WorkflowNodePanel } from './components/workflow-node-panel'
import { resolveInputHints } from './field-hints'
import {
  buildFlowEdges,
  createDefaultGraph,
  createNodeByKind,
  layoutRouterNodes,
  routerStorageKey,
  samplePayload,
  withFixedNodeCopy,
  type WorkflowFlowEdge,
} from './graph-model'
import {
  appendNode,
  cloneNode,
  connectEdge,
  insertNode,
  removeEdges,
  removeNode,
  resolveInsertAnchor,
} from './graph-ops'
import {
  NODE_KIND_META,
  isProtectedNode,
  kindAccent,
  toCanvasNodeType,
  type AppendableKind,
} from './node-meta'
import type { NodeInsertRequest, NodeRunStatus, RouteFlowNode } from './node-data'
import { edgeTypes, nodeTypes } from './node-registry'
import { WorkflowGraphSchema } from './schemas'
import type { NodePosition, WorkflowGraph, WorkflowNodeKind, WorkflowNodeModel, WorkflowRunResult } from './types'

/** 画布下方的图例：只展示主干语义，控制输入与输出不重复色。 */
const legendKinds: WorkflowNodeKind[] = ['input', 'protocol-discovery', 'condition', 'queue-select', 'output']

/** 这些元素自身消费删除键，画布的键盘删除需要跳过。 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** 读取本地缓存的图；缓存不合法时回落到默认图。 */
function loadInitialGraph(): WorkflowGraph {
  try {
    const cached = localStorage.getItem(routerStorageKey)
    if (cached) {
      const parsed = WorkflowGraphSchema.safeParse(JSON.parse(cached) as unknown)
      if (parsed.success) {
        const graph = parsed.data as WorkflowGraph
        const hasInput = graph.nodes.some(node => node.kind === 'input')
        const hasOutput = graph.nodes.some(node => node.kind === 'output')
        if (hasInput && hasOutput) {
          return { ...graph, nodes: withFixedNodeCopy(layoutRouterNodes(graph.nodes)) }
        }
      }
    }
  } catch {
    // 忽略损坏的缓存
  }
  return createDefaultGraph()
}

/** 插入节点的落点：在两端点之间取中点，否则排在来源节点右侧。 */
function resolveInsertPosition(source: WorkflowNodeModel | null, target: WorkflowNodeModel | null): NodePosition {
  if (source && target) {
    return {
      x: Math.round((source.position.x + target.position.x) / 2),
      y: Math.round((source.position.y + target.position.y) / 2),
    }
  }
  if (source) {
    return { x: source.position.x + 320, y: source.position.y }
  }
  return { x: 0, y: 0 }
}

function WorkflowStudioCanvas() {
  const flow = useReactFlow<RouteFlowNode, WorkflowFlowEdge>()
  const toast = useToast()
  const logicalModels = useLogicalModels()

  const [graph, setGraph] = useState<WorkflowGraph>(loadInitialGraph)
  const graphRef = useRef(graph)
  graphRef.current = graph

  const [dockMode, setDockMode] = useState<'select' | 'pan'>('select')
  const [dragEnabled, setDragEnabled] = useState(true)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(420)
  const [testDrawerOpen, setTestDrawerOpen] = useState(false)
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(samplePayload, null, 2))
  const [payloadError, setPayloadError] = useState('')
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null)

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 620 })

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return

    const update = () => {
      const rect = element.getBoundingClientRect()
      setCanvasSize({
        width: rect.width,
        height: Math.max(420, window.innerHeight - rect.top - 28),
      })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  // ---- 图数据操作 ----------------------------------------------------------

  const updateNode = useCallback(
    (nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => {
      setGraph(current => ({
        ...current,
        nodes: withFixedNodeCopy(current.nodes.map(node => node.id === nodeId ? updater(node) : node)),
      }))
    },
    [],
  )

  const handleOpenNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
  }, [])

  const handleRequestInsert = useCallback((request: NodeInsertRequest) => {
    const current = graphRef.current
    const anchor = resolveInsertAnchor(current, request)
    if (!anchor) return

    const source = current.nodes.find(node => node.id === anchor.sourceNodeId) ?? null
    const target = anchor.targetNodeId
      ? current.nodes.find(node => node.id === anchor.targetNodeId) ?? null
      : null

    const newNode = createNodeByKind(request.kind, resolveInsertPosition(source, target))

    setGraph(latest => {
      const next = insertNode(latest, anchor, newNode)
      return { ...next, nodes: withFixedNodeCopy(next.nodes) }
    })
    setSelectedNodeId(newNode.id)
  }, [])

  const handleInsertOnEdge = useCallback((edgeId: string, kind: AppendableKind) => {
    handleRequestInsert({ kind, edgeId })
  }, [handleRequestInsert])

  const appendAtCanvasCenter = useCallback((kind: AppendableKind) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const position = rect
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 }

    const node = createNodeByKind(kind, position)
    setGraph(current => ({ ...appendNode(current, node) }))
    setSelectedNodeId(node.id)
  }, [flow])

  const handleDeleteNode = useCallback((nodeId: string) => {
    const node = graphRef.current.nodes.find(item => item.id === nodeId)
    if (!node || isProtectedNode(node)) return

    setGraph(current => removeNode(current, nodeId))
    setSelectedNodeId(current => current === nodeId ? null : current)
  }, [])

  /** 键盘删除（Delete / Backspace）走同一条通道，并拦住受保护的输入 / 输出节点。 */
  const handleNodesDelete = useCallback((deleted: RouteFlowNode[]) => {
    const removableIds = deleted
      .filter((deletedNode) => {
        const node = graphRef.current.nodes.find(item => item.id === deletedNode.id)
        return node ? !isProtectedNode(node) : false
      })
      .map(deletedNode => deletedNode.id)
    if (!removableIds.length) return

    setGraph(current => removableIds.reduce((acc, nodeId) => removeNode(acc, nodeId), current))
    setSelectedNodeId(current => current && removableIds.includes(current) ? null : current)
  }, [])

  /**
   * 工作台的选中态由页面自己维护（`selectedNodeId`），React Flow 内部并不知道，
   * 因此 `deleteKeyCode` 交给页面处理：只删除当前选中且不受保护的节点，
   * 输入 / 输出节点以及输入框内的删除一律放行给浏览器。
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (!selectedNodeId) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || EDITABLE_TAGS.has(target.tagName))) return
      const node = graphRef.current.nodes.find(item => item.id === selectedNodeId)
      if (!node || isProtectedNode(node)) return
      event.preventDefault()
      handleDeleteNode(selectedNodeId)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDeleteNode, selectedNodeId])

  const handleNodeMouseEnter = useCallback((_event: ReactMouseEvent, node: RouteFlowNode) => {
    setHoveredNodeId(node.id)
  }, [])

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null)
  }, [])

  const handleDuplicateNode = useCallback((nodeId: string) => {
    const node = graphRef.current.nodes.find(item => item.id === nodeId)
    if (!node) return

    const clone = cloneNode(node)
    setGraph(current => ({ ...appendNode(current, clone) }))
    setSelectedNodeId(clone.id)
  }, [])

  const handleConnect = useCallback((connection: Connection) => {
    const { source, target, sourceHandle } = connection
    if (!source || !target || source === target) return
    setGraph(current => connectEdge(current, source, sourceHandle ?? 'out', target))
  }, [])

  const handleEdgesDelete = useCallback((edges: WorkflowFlowEdge[]) => {
    if (!edges.length) return
    setGraph(current => removeEdges(current, edges.map(edge => edge.id)))
  }, [])

  // ---- 拖拽位置（rAF 节流写回图数据） --------------------------------------

  const dragRafRef = useRef<number | null>(null)
  const pendingDragRef = useRef<{ id: string; position: NodePosition } | null>(null)

  const flushDrag = useCallback(() => {
    dragRafRef.current = null
    const pending = pendingDragRef.current
    if (!pending) return
    pendingDragRef.current = null
    updateNode(pending.id, node => ({ ...node, position: pending.position }))
  }, [updateNode])

  const handleNodeDrag = useCallback((_event: MouseEvent | TouchEvent, node: RouteFlowNode) => {
    pendingDragRef.current = { id: node.id, position: node.position }
    if (dragRafRef.current !== null) return
    dragRafRef.current = requestAnimationFrame(flushDrag)
  }, [flushDrag])

  const handleNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, node: RouteFlowNode) => {
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }
    pendingDragRef.current = null
    updateNode(node.id, current => ({ ...current, position: node.position }))
  }, [updateNode])

  useEffect(() => () => {
    if (dragRafRef.current !== null) cancelAnimationFrame(dragRafRef.current)
  }, [])

  // ---- React Flow 数据 ----------------------------------------------------

  const runStatusByNode = useMemo(() => {
    const map = new Map<string, NodeRunStatus>()
    if (!runResult) return map
    runResult.trace.forEach(item => map.set(item.nodeId, item.success ? 'succeeded' : 'failed'))
    return map
  }, [runResult])

  const nodeCacheRef = useRef(new Map<string, { model: WorkflowNodeModel; flags: string; node: RouteFlowNode }>())

  const flowNodes = useMemo<RouteFlowNode[]>(() => {
    const draggable = dragEnabled && dockMode === 'select'
    const previous = nodeCacheRef.current
    const next = new Map<string, { model: WorkflowNodeModel; flags: string; node: RouteFlowNode }>()

    const nodes = graph.nodes.map(model => {
      const sourcePorts = graph.edges
        .filter(edge => edge.sourceNodeId === model.id)
        .map(edge => String(edge.sourcePort))
      const targetConnected = graph.edges.some(edge => edge.targetNodeId === model.id)
      const runStatus = runStatusByNode.get(model.id) ?? 'idle'
      const flags = `${model.id === selectedNodeId}|${draggable}|${runStatus}|${sourcePorts.join(',')}|${targetConnected}`

      const cached = previous.get(model.id)
      if (cached && cached.model === model && cached.flags === flags) {
        next.set(model.id, cached)
        return cached.node
      }

      const node: RouteFlowNode = {
        id: model.id,
        type: toCanvasNodeType(model.kind),
        position: model.position,
        draggable,
        data: {
          model,
          isSelected: model.id === selectedNodeId,
          runStatus,
          connectedSourcePorts: [...new Set(sourcePorts)],
          targetConnected,
          canInsert: true,
          onOpen: handleOpenNode,
          onUpdateNode: updateNode,
          onRequestInsert: handleRequestInsert,
          onDeleteNode: handleDeleteNode,
          onDuplicateNode: handleDuplicateNode,
        },
      }

      next.set(model.id, { model, flags, node })
      return node
    })

    nodeCacheRef.current = next
    return nodes
  }, [
    dragEnabled,
    dockMode,
    graph,
    handleDeleteNode,
    handleDuplicateNode,
    handleOpenNode,
    handleRequestInsert,
    runStatusByNode,
    selectedNodeId,
    updateNode,
  ])

  const flowEdges = useMemo(
    () => buildFlowEdges(graph, { onInsert: handleInsertOnEdge, runStatusByNode, hoveredNodeId }),
    [graph, handleInsertOnEdge, hoveredNodeId, runStatusByNode],
  )

  const hasFitViewRef = useRef(false)
  useEffect(() => {
    if (hasFitViewRef.current) return
    const frame = requestAnimationFrame(() => {
      hasFitViewRef.current = true
      void flow.fitView({ padding: 0.2 })
    })
    return () => cancelAnimationFrame(frame)
  }, [flow])

  // ---- 选中节点与字段提示 --------------------------------------------------

  const selectedNode = useMemo(
    () => graph.nodes.find(node => node.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  )

  const conditionFieldHints = useMemo(() => {
    if (!selectedNode || selectedNode.kind !== 'condition') return []
    return resolveInputHints(graph, selectedNode.id, samplePayload).fields
  }, [graph, selectedNode])

  // ---- 运行与保存 ----------------------------------------------------------

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

  const draggable = dragEnabled && dockMode === 'select'

  return (
    <PageLayout>
      <PageHeader
        title="Router"
        description="用基础节点组合出路由策略：输入 → 协议发现 → 条件 → 队列选择 → 输出"
        actions={(
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setTestDrawerOpen(true)}>
              <CirclePlay className="size-4" /> 测试运行
            </Button>
            <Button type="button" size="sm" onClick={saveWorkflow}>
              <Save className="size-4" /> 保存
            </Button>
          </>
        )}
      />

      <PageContent>
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          {legendKinds.map(kind => (
            <span key={kind} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', kindAccent(kind))} />
              {NODE_KIND_META[kind].label}
            </span>
          ))}
          <span className="ml-auto hidden text-muted-foreground/70 sm:inline">
            拖动节点组合策略 · 端口 + 号插入节点 · 拖拽端口连线 · 点击节点配置
          </span>
        </div>

        <Card className="w-full ring-0">
          <CardContent>
            <div
              ref={canvasRef}
              className="relative w-full overflow-hidden rounded-xl bg-muted/30"
              style={{ height: canvasSize.height }}
            >
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                connectionLineComponent={WorkflowConnectionLine}
                defaultEdgeOptions={{ type: 'workflow' }}
                proOptions={{ hideAttribution: true }}
                onlyRenderVisibleElements
                snapToGrid
                snapGrid={[16, 16]}
                nodeDragThreshold={1}
                nodesDraggable={draggable}
                panOnDrag={dockMode === 'pan'}
                selectionOnDrag={dockMode === 'select'}
                selectionMode={SelectionMode.Partial}
                deleteKeyCode={null}
                multiSelectionKeyCode={null}
                selectionKeyCode={null}
                minZoom={0.25}
                onConnect={handleConnect}
                onEdgesDelete={handleEdgesDelete}
                onNodesDelete={handleNodesDelete}
                onNodeDrag={handleNodeDrag}
                onNodeDragStop={handleNodeDragStop}
                onNodeMouseEnter={handleNodeMouseEnter}
                onNodeMouseLeave={handleNodeMouseLeave}
                onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                className="workflow-reactflow"
              >
                {/* 点阵参数对齐 Dify `workflow/index.tsx`：gap 14 / size 2；
                    颜色变量 Dify 定义在未随仓库提供的 dify-ui 包里，这里用主题色映射。 */}
                <Background gap={[14, 14]} size={2} color="hsl(var(--muted-foreground) / 0.2)" />
                <Controls className="router-controls" showInteractive={false} />
              </ReactFlow>

              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
                <div className="pointer-events-auto inline-flex max-w-full items-center gap-1 rounded-2xl bg-popover p-1.5 text-foreground">
                  <NodeSelector
                    placement="top"
                    onSelect={appendAtCanvasCenter}
                    trigger={(
                      <button
                        type="button"
                        aria-label="添加节点"
                        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </button>
                    )}
                  />

                  <Separator orientation="vertical" className="mx-1!" />

                  <button
                    type="button"
                    aria-label="框选模式"
                    className={cn(
                      'flex size-7 items-center justify-center rounded-lg transition-colors',
                      dockMode === 'select' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                    onClick={() => setDockMode('select')}
                  >
                    <MousePointer2 className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="平移模式"
                    className={cn(
                      'flex size-7 items-center justify-center rounded-lg transition-colors',
                      dockMode === 'pan' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                    onClick={() => setDockMode('pan')}
                  >
                    <Hand className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={dragEnabled ? '锁定节点位置' : '解锁节点位置'}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-lg transition-colors',
                      dragEnabled ? 'text-muted-foreground hover:bg-accent hover:text-foreground' : 'bg-primary text-primary-foreground',
                    )}
                    onClick={() => setDragEnabled(value => !value)}
                  >
                    {dragEnabled ? <LockOpen className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
                  </button>

                  <Separator orientation="vertical" className="mx-1!" />

                  <button
                    type="button"
                    aria-label="适应画布"
                    className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => void flow.fitView({ padding: 0.2 })}
                  >
                    <LocateFixed className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>

              {selectedNode && (
                <WorkflowNodePanel
                  model={selectedNode}
                  canvasWidth={canvasSize.width}
                  width={panelWidth}
                  onWidthChange={setPanelWidth}
                  nodeModels={graph.nodes}
                  logicalModels={logicalModels}
                  conditionFieldHints={conditionFieldHints}
                  updateNode={updateNode}
                  onDelete={handleDeleteNode}
                  onClose={() => setSelectedNodeId(null)}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </PageContent>

      <Drawer open={testDrawerOpen} onOpenChange={setTestDrawerOpen} direction="right">
        <DrawerContent className="h-full w-208! max-w-[90vw]! bg-popover">
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
                        <div key={`${item.nodeId}-${item.message}`} className="rounded-md bg-muted p-2 text-xs">
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
