import { useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowRight, CirclePlay, Plus, Workflow } from 'lucide-react'
import { PageContent, PageHeader, PageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { cn } from '@/lib/utils'
import { runWorkflow } from './engine'
import type { WorkflowNodeKind, WorkflowNodeModel, WorkflowRunResult } from './types'

const queueOptions = ['queue-vip-cn', 'queue-default', 'queue-low-priority', 'queue-fallback']

const initialModels: WorkflowNodeModel[] = [
  {
    id: 'input',
    kind: 'input',
    name: '输入',
    enabled: true,
    description: '固定输入节点，承接上游请求负载。',
    position: { x: 80, y: 240 },
    next: 'condition-vip',
  },
  {
    id: 'condition-vip',
    kind: 'condition',
    name: 'VIP 条件判断',
    enabled: true,
    description: '识别高优先级租户并分流。',
    position: { x: 380, y: 225 },
    path: 'request.tenant',
    operator: 'contains',
    value: 'vip',
    nextTrue: 'transform-prompt',
    nextFalse: 'queue-default',
  },
  {
    id: 'transform-prompt',
    kind: 'transformer',
    name: '规范化 Prompt',
    enabled: true,
    description: '清理 prompt 空白，降低模型差异影响。',
    position: { x: 760, y: 120 },
    fromPath: 'request.prompt',
    toPath: 'request.prompt',
    mode: 'trim',
    next: 'queue-vip',
  },
  {
    id: 'queue-default',
    kind: 'queue',
    name: '默认队列转发',
    enabled: true,
    description: '普通请求进入默认服务队列。',
    position: { x: 760, y: 320 },
    queueId: 'queue-default',
    next: 'output',
  },
  {
    id: 'queue-vip',
    kind: 'queue',
    name: 'VIP 队列转发',
    enabled: true,
    description: 'VIP 请求进入低延迟队列。',
    position: { x: 1120, y: 120 },
    queueId: 'queue-vip-cn',
    next: 'output',
  },
  {
    id: 'output',
    kind: 'output',
    name: '输出',
    enabled: true,
    description: '固定输出节点，结束流程并交给发送阶段。',
    position: { x: 1460, y: 240 },
  },
]

const samplePayload = {
  request: {
    tenant: 'vip-cn',
    path: '/v1/messages',
    priority: 8,
    prompt: '  Please summarize this article.  ',
  },
  metadata: {
    source: 'desktop',
  },
}

type WorkflowNodeData = {
  model: WorkflowNodeModel
  onOpen: (nodeId: string) => void
}

function kindLabel(kind: WorkflowNodeKind): string {
  if (kind === 'input') return '输入'
  if (kind === 'output') return '输出'
  if (kind === 'condition') return '条件'
  if (kind === 'modifier') return '修改'
  if (kind === 'transformer') return '转换'
  return '队列'
}

function kindTone(kind: WorkflowNodeKind): string {
  if (kind === 'input') return 'bg-info/14 text-info'
  if (kind === 'output') return 'bg-success/14 text-success-foreground'
  if (kind === 'condition') return 'bg-warning/14 text-warning-foreground'
  if (kind === 'modifier') return 'bg-primary/14 text-primary'
  if (kind === 'transformer') return 'bg-primary/10 text-primary'
  return 'bg-muted text-muted-foreground'
}

function modelSummary(model: WorkflowNodeModel): string {
  if (model.kind === 'input') return `next -> ${model.next}`
  if (model.kind === 'output') return '流程输出终点'
  if (model.kind === 'condition') return `${model.path} ${model.operator} ${model.value}`
  if (model.kind === 'modifier') return `${model.path} = ${model.value}`
  if (model.kind === 'transformer') return `${model.fromPath} -> ${model.toPath} (${model.mode})`
  return `queue: ${model.queueId}`
}

function isFixedNode(model: WorkflowNodeModel): boolean {
  return model.kind === 'input' || model.kind === 'output'
}

function BaseNodeView({ data }: { data: WorkflowNodeData }) {
  const model = data.model
  const fixed = isFixedNode(model)

  return (
    <button
      type="button"
      onClick={() => data.onOpen(model.id)}
      className={cn(
        'w-64 rounded-xl bg-card px-3 py-2 text-left ring-1 ring-foreground/10 transition-colors hover:bg-card/85',
        !model.enabled && !fixed && 'opacity-55',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', kindTone(model.kind))}>{kindLabel(model.kind)}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{fixed ? 'fixed' : 'editable'}</span>
      </div>
      <div className="truncate text-xs font-medium">{model.name}</div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground">{modelSummary(model)}</div>

      {model.kind !== 'input' && (
        <>
          <Handle type="target" position={Position.Left} className="size-3! border-0! bg-info!" />
          <span className="absolute -left-7 top-9 text-[10px] text-muted-foreground">in</span>
        </>
      )}

      {model.kind !== 'output' && model.kind !== 'condition' && (
        <>
          <Handle type="source" position={Position.Right} className="size-3! border-0! bg-success!" />
          <span className="absolute -right-8 top-9 text-[10px] text-muted-foreground">out</span>
        </>
      )}

      {model.kind === 'condition' && (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: 30 }} className="size-3! border-0! bg-success!" />
          <Handle id="false" type="source" position={Position.Right} style={{ top: 56 }} className="size-3! border-0! bg-warning!" />
          <span className="absolute -right-11 top-5 text-[10px] text-success">true</span>
          <span className="absolute -right-12 top-12 text-[10px] text-warning">false</span>
        </>
      )}
    </button>
  )
}

const nodeTypes = {
  input: BaseNodeView,
  output: BaseNodeView,
  condition: BaseNodeView,
  modifier: BaseNodeView,
  transformer: BaseNodeView,
  queue: BaseNodeView,
}

function buildFlowNodes(models: WorkflowNodeModel[], onOpen: (id: string) => void): Node<WorkflowNodeData>[] {
  return models.map(model => ({
    id: model.id,
    type: model.kind,
    position: model.position,
    draggable: !isFixedNode(model),
    data: { model, onOpen },
  }))
}

function buildFlowEdges(models: WorkflowNodeModel[]): Edge[] {
  const edges: Edge[] = []
  for (const model of models) {
    if (model.kind === 'output') continue
    if (model.kind === 'condition') {
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

  return {
    id,
    kind: 'queue',
    name: '队列节点',
    enabled: true,
    description: '设置调度目标队列。',
    position,
    queueId: queueOptions[1],
    next: nextId,
  }
}

function WorkflowStudioCanvas() {
  const flow = useReactFlow<Node<WorkflowNodeData>, Edge>()
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const [models, setModels] = useState<WorkflowNodeModel[]>(initialModels)
  const [menuKind, setMenuKind] = useState<WorkflowNodeKind>('modifier')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; clientX: number; clientY: number } | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [payloadText, setPayloadText] = useState(JSON.stringify(samplePayload, null, 2))
  const [payloadError, setPayloadError] = useState('')
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null)

  const nodeIds = useMemo(() => models.map(model => model.id), [models])
  const flowNodes = useMemo(() => buildFlowNodes(models, nodeId => { setSelectedNodeId(nodeId); setDrawerOpen(true) }), [models])
  const flowEdges = useMemo(() => buildFlowEdges(models), [models])
  const selectedNode = useMemo(() => models.find(model => model.id === selectedNodeId) ?? null, [models, selectedNodeId])

  const updateNode = (nodeId: string, updater: (node: WorkflowNodeModel) => WorkflowNodeModel) => {
    setModels(current => current.map(node => (node.id === nodeId ? updater(node) : node)))
  }

  const rewireRemovedNode = (removedId: string) => {
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
  }

  const appendNode = (position: { x: number; y: number }) => {
    const newNode = createNodeByKind(menuKind, position, 'output')
    setModels(current => [...current, newNode])
    setContextMenu(null)
  }

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    updateNode(connection.source, node => {
      if (node.kind === 'condition') {
        if (connection.sourceHandle === 'false') return { ...node, nextFalse: connection.target! }
        return { ...node, nextTrue: connection.target! }
      }
      if (node.kind === 'output') return node
      return { ...node, next: connection.target! }
    })
  }

  const runLocalTest = () => {
    try {
      const payload = JSON.parse(payloadText) as unknown
      setRunResult(runWorkflow(models, payload))
      setPayloadError('')
    } catch {
      setPayloadError('输入负载不是合法 JSON。')
    }
  }

  return (
    <PageLayout>
      <PageHeader
        title="流程编排工作台"
        description="高保真原型：暗色菜单、节点概览、明确输入输出锚点、Drawer 详情配置"
        actions={(
          <div className="flex items-center gap-2 rounded-xl bg-zinc-900/95 p-1.5 text-zinc-100">
            <Select value={menuKind} onValueChange={value => setMenuKind(value as WorkflowNodeKind)}>
              <SelectTrigger className="h-8 w-40 border-zinc-700 bg-zinc-900 text-xs text-zinc-100">
                <SelectValue placeholder="节点类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="condition">条件节点</SelectItem>
                <SelectItem value="modifier">修改节点</SelectItem>
                <SelectItem value="transformer">转换节点</SelectItem>
                <SelectItem value="queue">队列节点</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" size="sm" className="bg-zinc-100 text-zinc-900 hover:bg-zinc-200" onClick={() => appendNode({ x: 520, y: 420 })}>
              <Plus className="size-4" /> 添加节点
            </Button>
            <Button type="button" size="sm" variant="secondary" className="bg-zinc-800 text-zinc-100 hover:bg-zinc-700" onClick={runLocalTest}>
              <CirclePlay className="size-4" /> 测试运行
            </Button>
          </div>
        )}
      />

      <PageContent>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Workflow className="size-4" /> 编排画布</CardTitle>
            <CardDescription>右键空白处可添加节点；点击节点打开 Drawer 编辑详细配置；拖拽连线可重设流向。</CardDescription>
          </CardHeader>
          <CardContent>
            <div ref={canvasRef} className="relative h-140 w-full overflow-hidden rounded-xl bg-muted/30">
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                onConnect={handleConnect}
                onPaneClick={() => setContextMenu(null)}
                onPaneContextMenu={event => {
                  event.preventDefault()
                  const rect = canvasRef.current?.getBoundingClientRect()
                  if (!rect) return
                  setContextMenu({
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                    clientX: event.clientX,
                    clientY: event.clientY,
                  })
                }}
                onNodeDragStop={(_, node) => {
                  updateNode(node.id, current => ({ ...current, position: node.position }))
                }}
                className="workflow-reactflow"
              >
                <Background gap={20} size={1} color="hsl(var(--muted-foreground) / 0.22)" />
                <MiniMap pannable zoomable className="bg-card! ring-1! ring-foreground/10!" />
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
                    { kind: 'modifier' as const, label: '修改节点' },
                    { kind: 'transformer' as const, label: '转换节点' },
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
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>测试输入</CardTitle>
              <CardDescription>输入本地 JSON 进行流程回放。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea value={payloadText} onChange={event => setPayloadText(event.target.value)} className="min-h-56 font-mono text-[12px]" />
              {payloadError && <div className="text-xs text-destructive">{payloadError}</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ArrowRight className="size-4" /> 测试结果</CardTitle>
              <CardDescription>输出队列、停止原因和执行轨迹。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!runResult && <div className="rounded-lg bg-muted/45 p-3 text-xs text-muted-foreground">点击“测试运行”查看结果。</div>}

              {runResult && (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={runResult.targetQueue ? 'success' : 'muted'}>queue: {runResult.targetQueue ?? 'null'}</Badge>
                    <Badge variant="info">stop: {runResult.stopReason}</Badge>
                  </div>
                  <div className="rounded-lg bg-muted/45 p-2 font-mono text-[11px]">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Output</div>
                    <pre className="whitespace-pre-wrap break-all">{JSON.stringify(runResult.outputPayload, null, 2)}</pre>
                  </div>
                  <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg bg-muted/35 p-2">
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
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContent>

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

                {(selectedNode.kind === 'input' || selectedNode.kind === 'modifier' || selectedNode.kind === 'transformer' || selectedNode.kind === 'queue') && (
                  <div className="grid gap-1.5">
                    <Label>输出到</Label>
                    <Select
                      value={selectedNode.next}
                      onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'output' ? node : { ...node, next: value })}
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder="next" /></SelectTrigger>
                      <SelectContent>
                        {nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

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
                            <SelectItem value="gt">gt</SelectItem>
                            <SelectItem value="exists">exists</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label>比较值</Label>
                        <Input value={selectedNode.value} onChange={event => updateNode(selectedNode.id, node => node.kind === 'condition' ? { ...node, value: event.target.value } : node)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1.5">
                        <Label>true 分支</Label>
                        <Select value={selectedNode.nextTrue} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'condition' ? { ...node, nextTrue: value } : node)}>
                          <SelectTrigger className="w-full"><SelectValue placeholder="nextTrue" /></SelectTrigger>
                          <SelectContent>
                            {nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label>false 分支</Label>
                        <Select value={selectedNode.nextFalse} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'condition' ? { ...node, nextFalse: value } : node)}>
                          <SelectTrigger className="w-full"><SelectValue placeholder="nextFalse" /></SelectTrigger>
                          <SelectContent>
                            {nodeIds.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
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
                  <div className="grid gap-1.5">
                    <Label>目标队列</Label>
                    <Select value={selectedNode.queueId} onValueChange={value => updateNode(selectedNode.id, node => node.kind === 'queue' ? { ...node, queueId: value } : node)}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="queue" /></SelectTrigger>
                      <SelectContent>
                        {queueOptions.map(queue => <SelectItem key={queue} value={queue}>{queue}</SelectItem>)}
                      </SelectContent>
                    </Select>
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
