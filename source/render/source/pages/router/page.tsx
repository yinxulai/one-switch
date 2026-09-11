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
import { DifyButton } from './components/dify-button'
import { PolicyMenu } from './components/policy-menu'
import { VersionMenu } from './components/version-menu'
import { WorkflowConnectionLine } from './components/workflow-connection-line'
import { WorkflowNodePanel } from './components/workflow-node-panel'
import { resolveInputHints } from './field-hints'
import {
  appendVersion,
  createVersion,
  isSameGraph,
  nextSequence,
  readVersions,
  writeVersions,
  type RouterGraphVersion,
} from './graph-versions'
import {
  ROUTER_POLICY_PRESETS,
  buildFlowEdges,
  createDefaultGraph,
  createNodeByKind,
  layoutRouterNodes,
  routerStorageKey,
  samplePayload,
  withFixedNodeCopy,
  type RouterPolicyPreset,
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
  const [versions, setVersions] = useState<RouterGraphVersion[]>(readVersions)
  const versionsRef = useRef(versions)
  versionsRef.current = versions

  /**
   * 测试输入框的行数随内容增长（上限 28 行），剩下的交给抽屉整体滚动。
   * 这样小窗口里不会出现「输入框自己滚 + 结果区自己滚」的双滚动条。
   */
  const payloadRows = useMemo(
    () => Math.min(28, Math.max(8, payloadText.split('\n').length + 1)),
    [payloadText],
  )

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
        // React Flow 把量到的尺寸记在 internal node 上，而 `adoptUserNodes` 重建内部节点时
        // 会直接取用户节点对象的 `measured`。这里重建对象（例如拖动时每帧写回位置）如果不把
        // 尺寸带回来，尺寸会被重置成 undefined：`calculateNodePosition` 会打印 error015
        // （“trying to drag a node that is not initialized”），框选 / fitView 等几何计算
        // 也会拿到 0 尺寸。
        measured: flow.getInternalNode(model.id)?.measured,
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
    flow,
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
      // maxZoom 限制在 1：图较小时 fitView 会放大到 1.5 倍并溢出可视区，
      // 首屏应该能一眼看完整个图。
      void flow.fitView({ padding: 0.25, maxZoom: 1 })
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

  /**
   * 保存 = 生成一个新版本。
   * 工作副本仍然写入 `routerStorageKey`（刷新后据此恢复画布），
   * 同时在版本列表里追加一条快照，供「历史版本」下拉回滚。
   * 内容与最新版本一致时不再重复生成，避免连点保存堆出一串重复版本。
   */
  const saveWorkflow = useCallback(() => {
    try {
      const current = graphRef.current
      const existing = versionsRef.current
      const latest = existing[0]
      if (latest && isSameGraph(latest.graph, current)) {
        toast.info(`当前内容与最新版本 v${latest.sequence} 一致，未生成新版本`)
        return
      }

      const version = createVersion(current, nextSequence(existing))
      const next = appendVersion(existing, version)
      writeVersions(next)
      setVersions(next)
      localStorage.setItem(routerStorageKey, JSON.stringify(current))
      toast.success(`已保存为新版本 v${version.sequence}`)
    } catch {
      toast.error('保存失败，请稍后重试')
    }
  }, [toast])

  /** 回到历史某个版本：画布与工作副本一起切过去，运行结果作废。 */
  const restoreVersion = useCallback((version: RouterGraphVersion) => {
    setGraph(version.graph)
    setSelectedNodeId(null)
    setRunResult(null)
    try {
      localStorage.setItem(routerStorageKey, JSON.stringify(version.graph))
    } catch {
      // 工作副本写入失败不影响画布切版
    }
    toast.success(`已回到版本 v${version.sequence}，未保存的改动已被替换`)
  }, [toast])

  /**
   * 套用内置策略：整张画布换成预设内容并立即写入工作副本。
   * 预设里没有用户的改动，所以不需要额外确认，但会清掉选中态与上次运行结果。
   */
  const applyPolicy = useCallback((preset: RouterPolicyPreset) => {
    const next = preset.createGraph()
    setGraph(next)
    setSelectedNodeId(null)
    setRunResult(null)
    try {
      localStorage.setItem(routerStorageKey, JSON.stringify(next))
    } catch {
      // 工作副本写入失败不影响画布切版
    }
    toast.success(`已套用策略：${preset.name}`)
  }, [toast])

  /** 当前画布与哪个预设一致（不一致时为 null）。 */
  const activePolicyId = useMemo(
    () => ROUTER_POLICY_PRESETS.find(preset => isSameGraph(preset.createGraph(), graph))?.id ?? null,
    [graph],
  )

  const draggable = dragEnabled && dockMode === 'select'

  /** 节点面板贴满窗口右侧，标题栏按钮需要让出它的宽度，否则会被面板盖住。 */
  const headerInset = selectedNode ? panelWidth : 0

  return (
    <PageLayout>
      <PageHeader
        title="Router"
        description="用基础节点组合出路由策略：输入 → 协议发现 → 条件 → 队列选择 → 输出"
        // 面板占掉右侧后标题栏会变窄，说明文案保持单行截断，避免换行把标题栏撑高、
        // 进而让画布高度在「选中/取消选中节点」之间跳动。
        className="[&_p]:truncate"
        actions={(
          // 标题栏不提供 gap，两个按钮直接放在 Fragment 里会贴在一起。
          // 节点面板是贴满整窗高度的窗口级面板，这里给它让出宽度，免得面板把按钮盖住。
          <div className="flex items-center gap-2" style={{ paddingRight: headerInset }}>
            <PolicyMenu activePolicyId={activePolicyId} onApply={applyPolicy} />
            <DifyButton size="medium" onClick={() => setTestDrawerOpen(true)}>
              <CirclePlay className="size-3.5" aria-hidden /> 测试运行
            </DifyButton>
            <DifyButton size="medium" variant="primary" onClick={saveWorkflow}>
              <Save className="size-3.5" aria-hidden /> 保存
            </DifyButton>
            <VersionMenu versions={versions} onRestore={restoreVersion} />
          </div>
        )}
      />

      <PageContent>
        <div className="flex items-center gap-4 system-xs-regular text-text-tertiary">
          {legendKinds.map(kind => (
            <span key={kind} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', kindAccent(kind))} />
              {NODE_KIND_META[kind].label}
            </span>
          ))}
          {/* 节点面板是窗口级固定定位，展开后会盖住这一行右侧，说明文案先收起。 */}
          {!selectedNode && (
            <span className="ml-auto hidden text-text-quaternary sm:inline">
              拖动节点组合策略 · 端口 + 号插入节点 · 拖拽端口连线 · 点击节点配置
            </span>
          )}
        </div>

        <Card className="w-full ring-0">
          <CardContent>
            <div
              ref={canvasRef}
              className="relative w-full overflow-hidden rounded-xl bg-workflow-canvas-workflow-bg"
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
                className="workflow-reactflow workflow-dify-surface"
              >
                {/* 点阵参数与底色逐字复制自 Dify `workflow/index.tsx` 的 <Background>。 */}
                <Background
                  gap={[14, 14]}
                  size={2}
                  className="bg-workflow-canvas-workflow-bg"
                  color="var(--color-workflow-canvas-workflow-dot-color)"
                />
                <Controls className="router-controls" showInteractive={false} />
              </ReactFlow>

              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
                {/* 容器样式对齐 Dify `workflow/operator/control.tsx` 的悬浮控制条：
                    actionbar 底色与画布只差一档明度，因此保留 Dify 的 0.5px 描边、省略阴影。 */}
                <div className="pointer-events-auto inline-flex max-w-full items-center gap-0.5 rounded-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0.5 text-text-tertiary backdrop-blur-[5px]">
                  <NodeSelector
                    placement="top"
                    onSelect={appendAtCanvasCenter}
                    trigger={(
                      <button
                        type="button"
                        aria-label="添加节点"
                        className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
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
                      'flex size-8 items-center justify-center rounded-lg transition-colors',
                      dockMode === 'select' ? 'bg-state-accent-solid text-components-button-primary-text' : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                    )}
                    onClick={() => setDockMode('select')}
                  >
                    <MousePointer2 className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="平移模式"
                    className={cn(
                      'flex size-8 items-center justify-center rounded-lg transition-colors',
                      dockMode === 'pan' ? 'bg-state-accent-solid text-components-button-primary-text' : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
                    )}
                    onClick={() => setDockMode('pan')}
                  >
                    <Hand className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={dragEnabled ? '锁定节点位置' : '解锁节点位置'}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-lg transition-colors',
                      dragEnabled ? 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary' : 'bg-state-accent-solid text-components-button-primary-text',
                    )}
                    onClick={() => setDragEnabled(value => !value)}
                  >
                    {dragEnabled ? <LockOpen className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
                  </button>

                  <Separator orientation="vertical" className="mx-1!" />

                  <button
                    type="button"
                    aria-label="适应画布"
                    className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
                    onClick={() => void flow.fitView({ padding: 0.25, maxZoom: 1 })}
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
        <DrawerContent className="workflow-test-drawer workflow-dify-surface h-full w-208! max-w-[90vw]! border-l-[0.5px] border-components-panel-border bg-components-panel-bg">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2"><ArrowRight className="size-4" /> 测试运行</DrawerTitle>
            <DrawerDescription>在此输入 JSON，执行路由并查看结果与完整轨迹。</DrawerDescription>
          </DrawerHeader>

          {/* 输入与结果共用一个滚动容器：窗口变小时整体滚动，
              而不是输入区、结果区各滚各的（结果里的 Trace 也不再单独滚动）。 */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            <div className="flex flex-col gap-2">
              <div className="py-1 system-sm-medium text-text-secondary">测试输入</div>
              <Textarea
                value={payloadText}
                onChange={event => setPayloadText(event.target.value)}
                rows={payloadRows}
                className="min-h-24 resize-none font-mono text-[12px] leading-5"
              />
              {payloadError && <div className="system-xs-regular text-text-destructive">{payloadError}</div>}
            </div>

            <div className="flex flex-col gap-3">
              <div className="py-1 system-sm-medium text-text-secondary">测试结果</div>
              {!runResult && <div className="rounded-lg bg-workflow-block-parma-bg p-3 system-xs-regular text-text-tertiary">点击下方“运行测试”查看结果。</div>}

              {runResult && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={runResult.stopReason === 'output' ? 'success' : 'warning'}>
                      路由状态：{runResult.stopReason === 'output' ? '已到达输出节点' : runResult.stopReason}
                    </Badge>
                    <Badge variant="info">协议：{runResult.protocol}</Badge>
                    <Badge variant="muted">节点数：{runResult.trace.length}</Badge>
                  </div>
                  <div className="rounded-lg bg-workflow-block-parma-bg p-2 font-mono system-2xs-regular">
                    <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary">解析结果（调试详情）</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(runResult.queueSelections, null, 2)}</pre>
                  </div>
                  <div className="rounded-lg bg-workflow-block-parma-bg p-2 font-mono system-2xs-regular">
                    <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary">Output</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(runResult.outputPayload, null, 2)}</pre>
                  </div>
                  <div className="space-y-1.5 rounded-lg bg-workflow-block-parma-bg p-2">
                    <div className="system-2xs-medium-uppercase text-text-tertiary">Trace</div>
                    <div className="space-y-1.5">
                      {runResult.trace.map(item => (
                        <div key={`${item.nodeId}-${item.message}`} className="rounded-md bg-workflow-block-bg p-2 system-xs-regular">
                          <div className="mb-0.5 flex items-center gap-2">
                            <span className="system-xs-medium text-text-primary">{item.nodeName}</span>
                            <Badge variant={item.success ? 'success' : 'warning'}>{item.kind}</Badge>
                          </div>
                          <div className="text-text-tertiary">{item.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <DrawerFooter className="flex-row justify-end">
            <DifyButton size="medium" variant="primary" onClick={runLocalTest}>运行测试</DifyButton>
            <DifyButton size="medium" onClick={() => setTestDrawerOpen(false)}>关闭</DifyButton>
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
