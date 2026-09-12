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
import { useTranslation } from '@/i18n/provider'
import { cn } from '@/lib/utils'

import { NodeSelector } from './components/node-selector'
import { DifyButton } from './components/dify-button'
import { PolicyMenu } from './components/policy-menu'
import { VersionMenu } from './components/version-menu'
import { WorkflowConnectionLine } from './components/workflow-connection-line'
import { WorkflowNodePanel } from './components/workflow-node-panel'
import { resolveInputHints } from './field-hints'
import { policyPresetTextKeys } from './policy-preset-text'
import { buildFlowEdges, layoutRouterNodes, type WorkflowFlowEdge } from './flow-projection'
import { toRouterGraphVersion, toRouterGraphVersions, type RouterGraphVersion } from './graph-versions'
import {
  ROUTER_POLICY_PRESETS,
  createDefaultGraph,
  createNodeByKind,
  isSameGraph,
  samplePayload,
  withFixedNodeCopy,
  type RouterPolicyPreset,
} from '@common/router/presets'
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
} from './node-meta'
import type { NodeInsertRequest, NodeRunStatus, RouteFlowNode } from './node-data'
import { edgeTypes, nodeTypes } from './node-registry'
import type { AppendableKind, NodePosition, WorkflowGraph, WorkflowNodeKind, WorkflowNodeModel, WorkflowRunResult } from '@common/router/types'

/** 画布下方的图例：只展示主干语义，控制输入与输出不重复色。 */
const legendKinds: WorkflowNodeKind[] = ['input', 'protocol-discovery', 'condition', 'iteration', 'script', 'prompt', 'model-select', 'output']

/** 这些元素自身消费删除键，画布的键盘删除需要跳过。 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** 单条节点输出的值转成一行文本：字符串直出，数组用逗号连接，其余走 JSON。 */
function formatNodeOutputValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value.length === 0 ? '—' : value
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ')
  }
  return JSON.stringify(value)
}

/** 服务端返回的图直接铺到画布上：补齐固定节点文案，并按分层算法重排坐标。 */
function toCanvasGraph(graph: WorkflowGraph): WorkflowGraph {
  return { ...graph, nodes: withFixedNodeCopy(layoutRouterNodes(graph.nodes)) }
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
  const t = useTranslation()
  const logicalModels = useLogicalModels()
  /**
   * 预设生成与测试运行共用的逻辑模型列表。
   *
   * 预设的落点在生成时就要定成真实 id，所以它必须拿到当前这份列表；
   * 测试运行的负载也注入同一份，两侧看到的模型完全一致。
   */
  const runtimeLogicalModels = useMemo(
    () => logicalModels.map(model => ({ id: model.id, name: model.name, enabled: model.enabled })),
    [logicalModels],
  )

  const [graph, setGraph] = useState<WorkflowGraph>(createDefaultGraph)
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
  const [versions, setVersions] = useState<RouterGraphVersion[]>([])

  /**
   * 首屏从服务端拉一次「当前生效的图」与版本列表。
   *
   * 图只有服务端一份：画布打开时看到的，就是代理此刻正在执行的那张；
   * 一版都没保存过时服务端会给出内建默认策略，而不是让画布自己造一张空图。
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [snapshot, summaries] = await Promise.all([
          unwrap(routerApi.getGraph()),
          unwrap(routerApi.getGraphVersions()),
        ])
        if (cancelled) return
        if (snapshot) setGraph(toCanvasGraph(snapshot.graph))
        setVersions(toRouterGraphVersions(summaries))
      } catch (error) {
        if (cancelled) return
        toast.error(error instanceof Error ? error.message : t('router.error.loadGraph'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [toast, t])

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
      const next = {
        width: rect.width,
        height: Math.max(420, window.innerHeight - rect.top - 28),
      }
      // 量出来的高度会作为 inline style 写回这个元素自己，而它同时又是被观察的对象：
      // 「量一次 → 重渲染 → 改高度 → ResizeObserver 再触发 → 再量一次」。
      // 值没变时必须跳过写 state，否则窗口拖拽期间每帧都多一次全画布重渲染。
      setCanvasSize(current => (current.width === next.width && current.height === next.height ? current : next))
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

  /**
   * 运行结果按节点分组呈现。
   * 数据本身挂在节点 id 上（同一节点可能产出多条），所以这里只负责把 id 翻译成节点名称。
   */
  const nodeOutputGroups = useMemo(() => {
    if (!runResult) return []
    const nameById = new Map(graph.nodes.map(node => [node.id, node.name]))
    return Object.entries(runResult.nodeOutputs).map(([nodeId, outputs]) => ({
      nodeId,
      nodeName: nameById.get(nodeId) ?? nodeId,
      outputs,
    }))
  }, [graph.nodes, runResult])

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
      // 尺寸必须参与缓存键：React Flow 是异步量节点的，首帧量到的是 undefined，
      // 之后才拿到真实尺寸。不把它算进来的话，缓存会一直拿首次那个 `measured: undefined` 的对象，
      // 后续 `adoptUserNodes` 重建内部节点时尺寸就被抹平（拖动时报 error015、fitView 拿到 0 尺寸）。
      const measured = flow.getInternalNode(model.id)?.measured
      const flags = `${model.id === selectedNodeId}|${draggable}|${runStatus}|${sourcePorts.join(',')}|${targetConnected}|${measured?.width ?? 0}x${measured?.height ?? 0}`

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
        measured,
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
    if (!selectedNode) return []
    // 条件节点用它挑字段，逻辑模型选择节点用它挑「变量取值」的来源字段，
    // 遍历迭代节点用它挑遍历来源与结果写回路径，脚本与 LLM 节点用它挑结果写回路径。
    if (
      selectedNode.kind !== 'condition'
      && selectedNode.kind !== 'model-select'
      && selectedNode.kind !== 'iteration'
      && selectedNode.kind !== 'script'
      && selectedNode.kind !== 'prompt'
    ) return []
    return resolveInputHints(t, graph, selectedNode.id, samplePayload).fields
  }, [graph, selectedNode, samplePayload, t])

  // ---- 运行与保存 ----------------------------------------------------------

  const runLocalTest = useCallback(async () => {
    try {
      const payload = JSON.parse(payloadText) as unknown
      const normalizedPayload = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
      normalizedPayload.logicalModels = runtimeLogicalModels

      const result = await unwrap(routerApi.run(graph, normalizedPayload))
      setRunResult(result)
      setPayloadError('')
    } catch (error) {
      setRunResult(null)
      setPayloadError(error instanceof Error ? error.message : t('router.error.invalidPayload'))
    }
  }, [graph, runtimeLogicalModels, payloadText, t])

  /**
   * 保存 = 发布一个新版本。
   * 服务端把这一版落库并让它立刻对代理生效（没保存过时代理跑的是内建默认策略）；
   * 内容与最新版本一致时不会重复生成，避免连点保存堆出一串重复版本。
   */
  const saveWorkflow = useCallback(async () => {
    try {
      const result = await unwrap(routerApi.saveGraph(graphRef.current))
      if (!result.created) {
        toast.info(t('router.toast.identicalToLatest', { version: result.version }))
        return
      }
      setVersions(current => [toRouterGraphVersion(result), ...current])
      toast.success(t('router.toast.versionSaved', { version: result.version }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('router.error.saveFailed'))
    }
  }, [toast, t])

  /**
   * 把历史某一版载入画布。
   *
   * 载入只是「拿到编辑起点」：代理仍然跑着当前生效的那一版，直到这里再点一次「保存」。
   * 因此不会像从前那样改了本地副本就等于改了线上行为。
   */
  const restoreVersion = useCallback(async (version: RouterGraphVersion) => {
    try {
      const snapshot = await unwrap(routerApi.getGraphVersion(version.sequence))
      if (!snapshot) {
        toast.error(t('router.error.versionMissing', { sequence: version.sequence }))
        return
      }
      setGraph(toCanvasGraph(snapshot.graph))
      setSelectedNodeId(null)
      setRunResult(null)
      toast.success(t('router.toast.versionLoaded', { sequence: version.sequence }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('router.error.restoreFailed'))
    }
  }, [toast, t])

  /**
   * 套用内置策略：整张画布换成预设内容。
   * 预设里没有用户的改动，所以不需要额外确认，但会清掉选中态与上次运行结果。
   */
  const applyPolicy = useCallback((preset: RouterPolicyPreset) => {
    setGraph(preset.createGraph(runtimeLogicalModels))
    setSelectedNodeId(null)
    setRunResult(null)
    const textKeys = policyPresetTextKeys(preset.id)
    toast.success(t('router.toast.policyApplied', { name: textKeys ? t(textKeys.name) : preset.id }))
  }, [runtimeLogicalModels, toast, t])

  /** 当前画布与哪个预设一致（不一致时为 null）。 */
  const activePolicyId = useMemo(
    () => ROUTER_POLICY_PRESETS.find(preset => isSameGraph(preset.createGraph(runtimeLogicalModels), graph))?.id ?? null,
    [graph, runtimeLogicalModels],
  )

  const draggable = dragEnabled && dockMode === 'select'

  /** 节点面板贴满窗口右侧，标题栏按钮需要让出它的宽度，否则会被面板盖住。 */
  const headerInset = selectedNode ? panelWidth : 0

  return (
    <PageLayout>
      <PageHeader
        title={t('router.title')}
        description={t('router.description')}
        // 面板占掉右侧后标题栏会变窄，说明文案保持单行截断，避免换行把标题栏撑高、
        // 进而让画布高度在「选中/取消选中节点」之间跳动。
        className="[&_p]:truncate"
        actions={(
          // 标题栏不提供 gap，两个按钮直接放在 Fragment 里会贴在一起。
          // 节点面板是贴满整窗高度的窗口级面板，这里给它让出宽度，免得面板把按钮盖住。
          <div className="flex items-center gap-2" style={{ paddingRight: headerInset }}>
            <PolicyMenu activePolicyId={activePolicyId} onApply={applyPolicy} />
            <DifyButton size="medium" onClick={() => setTestDrawerOpen(true)}>
              <CirclePlay className="size-3.5" aria-hidden /> {t('router.run')}
            </DifyButton>
            <DifyButton size="medium" variant="primary" onClick={saveWorkflow}>
              <Save className="size-3.5" aria-hidden /> {t('router.save')}
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
              {t(NODE_KIND_META[kind].labelKey)}
            </span>
          ))}
          {/* 节点面板是窗口级固定定位，展开后会盖住这一行右侧，说明文案先收起。 */}
          {!selectedNode && (
            <span className="ml-auto hidden text-text-quaternary sm:inline">
              {t('router.legendHint')}
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
                        aria-label={t('router.canvas.addNodeAria')}
                        className="flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-state-base-hover hover:text-text-secondary"
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </button>
                    )}
                  />

                  <Separator orientation="vertical" className="mx-1!" />

                  <button
                    type="button"
                    aria-label={t('router.canvas.selectModeAria')}
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
                    aria-label={t('router.canvas.panModeAria')}
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
                    aria-label={dragEnabled ? t('router.canvas.lockAria') : t('router.canvas.unlockAria')}
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
                    aria-label={t('router.canvas.fitViewAria')}
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
            <DrawerTitle className="flex items-center gap-2"><ArrowRight className="size-4" /> {t('router.run')}</DrawerTitle>
            <DrawerDescription>{t('router.runPanel.description')}</DrawerDescription>
          </DrawerHeader>

          {/* 输入与结果共用一个滚动容器：窗口变小时整体滚动，
              而不是输入区、结果区各滚各的（结果里的 Trace 也不再单独滚动）。 */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            <div className="flex flex-col gap-2">
              <div className="py-1 system-sm-medium text-text-secondary">{t('router.runPanel.inputTitle')}</div>
              <Textarea
                value={payloadText}
                onChange={event => setPayloadText(event.target.value)}
                rows={payloadRows}
                className="min-h-24 resize-none font-mono text-[12px] leading-5"
              />
              {payloadError && <div className="system-xs-regular text-text-destructive">{payloadError}</div>}
            </div>

            <div className="flex flex-col gap-3">
              <div className="py-1 system-sm-medium text-text-secondary">{t('router.runPanel.resultTitle')}</div>
              {!runResult && <div className="rounded-lg border border-module-border bg-workflow-block-parma-bg p-3 system-xs-regular text-text-tertiary">{t('router.runPanel.emptyResult')}</div>}

              {runResult && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={runResult.stopReason === 'output' ? 'success' : 'warning'}>
                      {t('router.runPanel.routeStatus')}{runResult.stopReason === 'output' ? t('router.runPanel.reachedOutput') : runResult.stopReason}
                    </Badge>
                    <Badge variant="info">{t('router.runPanel.protocol')}{runResult.protocol}</Badge>
                    <Badge variant="muted">{t('router.runPanel.nodeCount')}{runResult.trace.length}</Badge>
                  </div>
                  <div className="space-y-1.5 rounded-lg border border-module-border bg-workflow-block-parma-bg p-2">
                    <div className="system-2xs-medium-uppercase text-text-tertiary">{t('router.runPanel.nodeOutputs')}</div>
                    {nodeOutputGroups.length === 0
                      ? <div className="system-xs-regular text-text-tertiary">{t('router.runPanel.noNodeOutputs')}</div>
                      : (
                        <div className="space-y-1.5">
                          {nodeOutputGroups.map(group => (
                            <div key={group.nodeId} className="rounded-md border border-module-border bg-workflow-block-bg p-2">
                              <div className="mb-1 flex items-center gap-2">
                                <span className="system-xs-medium text-text-primary">{group.nodeName}</span>
                                <span className="font-mono system-2xs-regular text-text-tertiary">{group.nodeId}</span>
                              </div>
                              <div className="space-y-0.5">
                                {group.outputs.map((output, index) => (
                                  <div key={`${output.name}-${index}`} className="flex items-start gap-2">
                                    <span className="shrink-0 system-xs-regular text-text-tertiary">{output.name}</span>
                                    <span className="min-w-0 flex-1 break-all font-mono system-2xs-regular text-text-secondary">
                                      {formatNodeOutputValue(output.value)}
                                    </span>
                                    {output.note && <Badge variant="muted">{output.note}</Badge>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                  <div className="rounded-lg border border-module-border bg-workflow-block-parma-bg p-2 font-mono system-2xs-regular">
                    <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary">Output</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(runResult.outputPayload, null, 2)}</pre>
                  </div>
                  <div className="space-y-1.5 rounded-lg border border-module-border bg-workflow-block-parma-bg p-2">
                    <div className="system-2xs-medium-uppercase text-text-tertiary">Trace</div>
                    <div className="space-y-1.5">
                      {runResult.trace.map(item => (
                        <div key={`${item.nodeId}-${item.message}`} className="rounded-md border border-module-border bg-workflow-block-bg p-2 system-xs-regular">
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
            <DifyButton size="medium" variant="primary" onClick={runLocalTest}>{t('router.runPanel.run')}</DifyButton>
            <DifyButton size="medium" onClick={() => setTestDrawerOpen(false)}>{t('common.action.close')}</DifyButton>
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
