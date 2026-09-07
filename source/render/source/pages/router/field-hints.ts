import {
  DEFAULT_OPERATOR_SET,
  type ConfigHints,
  type SchemaFieldDescriptor,
  type SchemaValueType,
  type WorkflowGraph,
  type WorkflowProtocol,
  type WorkflowTransport,
} from './types'

export const WORKFLOW_PROTOCOLS: WorkflowProtocol[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'unknown',
]

export const WORKFLOW_TRANSPORTS: WorkflowTransport[] = ['http', 'http-sse']

export interface WorkflowConnection {
  sourceNodeId: string
  sourcePort: string
  targetNodeId: string
}

export interface InputHintResult extends ConfigHints {
  upstreamNodeIds: string[]
}

export function buildWorkflowConnections(graph: WorkflowGraph): WorkflowConnection[] {
  return graph.edges.map(edge => ({
    sourceNodeId: edge.sourceNodeId,
    sourcePort: edge.sourcePort,
    targetNodeId: edge.targetNodeId,
  }))
}

function inferType(value: unknown): SchemaValueType {
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'unknown'
}

function flattenFields(source: unknown, prefix: string, sourceNodeId: string, sourcePort: string): SchemaFieldDescriptor[] {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return prefix
      ? [{ path: prefix, valueType: inferType(source), sourceNodeId, sourcePort }]
      : []
  }

  const fields: SchemaFieldDescriptor[] = []
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const nextPath = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      fields.push(...flattenFields(value, nextPath, sourceNodeId, sourcePort))
    } else {
      fields.push({
        path: nextPath,
        valueType: inferType(value),
        sourceNodeId,
        sourcePort,
      })
    }
  }
  return fields
}

function collectUpstreamConnections(graph: WorkflowGraph, targetNodeId: string): {
  connections: WorkflowConnection[]
  upstreamNodeIds: Set<string>
} {
  const knownNodeIds = new Set(graph.nodes.map(model => model.id))
  const incoming = new Map<string, WorkflowConnection[]>()

  for (const connection of buildWorkflowConnections(graph)) {
    if (!knownNodeIds.has(connection.targetNodeId)) continue
    const targetConnections = incoming.get(connection.targetNodeId) ?? []
    targetConnections.push(connection)
    incoming.set(connection.targetNodeId, targetConnections)
  }

  const upstreamConnections: WorkflowConnection[] = []
  const upstreamNodeIds = new Set<string>()
  const visitedTargets = new Set([targetNodeId])
  const pendingTargets = [targetNodeId]

  while (pendingTargets.length > 0) {
    const currentTarget = pendingTargets.shift()
    if (!currentTarget) continue

    for (const connection of incoming.get(currentTarget) ?? []) {
      upstreamConnections.push(connection)
      upstreamNodeIds.add(connection.sourceNodeId)
      if (visitedTargets.has(connection.sourceNodeId)) continue
      visitedTargets.add(connection.sourceNodeId)
      pendingTargets.push(connection.sourceNodeId)
    }
  }

  upstreamNodeIds.delete(targetNodeId)
  return { connections: upstreamConnections, upstreamNodeIds }
}

function addUniqueField(fields: SchemaFieldDescriptor[], field: SchemaFieldDescriptor): void {
  const existing = fields.find(item => item.path === field.path)
  if (!existing) {
    fields.push(field)
    return
  }

  if (existing.valueType === 'enum' && field.valueType === 'enum') {
    existing.enumOptions = [...new Set([...(existing.enumOptions ?? []), ...(field.enumOptions ?? [])])]
  }
}

export function resolveInputHints(graph: WorkflowGraph, targetNodeId: string, samplePayload: unknown): InputHintResult {
  const models = graph.nodes
  const { connections, upstreamNodeIds } = collectUpstreamConnections(graph, targetNodeId)
  const modelsById = new Map(models.map(model => [model.id, model]))
  const fields: SchemaFieldDescriptor[] = []

  for (const model of models) {
    if (!upstreamNodeIds.has(model.id)) continue

    if (model.kind === 'input') {
      for (const field of flattenFields(samplePayload, '', model.id, 'context')) addUniqueField(fields, field)
      addUniqueField(fields, {
        path: 'queues',
        valueType: 'array',
        sourceNodeId: model.id,
        sourcePort: 'context',
      })
      addUniqueField(fields, {
        path: 'metadata.router.requestModelId',
        valueType: 'string',
        sourceNodeId: model.id,
        sourcePort: 'context',
      })
      addUniqueField(fields, {
        path: 'metadata.router.queueIds',
        valueType: 'array',
        sourceNodeId: model.id,
        sourcePort: 'context',
      })
      addUniqueField(fields, {
        path: 'metadata.router.requestModelInQueues',
        valueType: 'boolean',
        sourceNodeId: model.id,
        sourcePort: 'context',
      })
      continue
    }

    if (!model.enabled) continue

    if (model.kind === 'control-input') {
      for (const control of model.controls) {
        if (!control.enabled) continue
        addUniqueField(fields, {
          path: `metadata.controls.${control.key}`,
          valueType: control.kind === 'switch' ? 'boolean' : 'enum',
          sourceNodeId: model.id,
          sourcePort: control.id,
          enumOptions: control.kind === 'select' && control.options
            ? control.options.map(option => option.value)
            : undefined,
        })
      }
      continue
    }

    if (model.kind === 'protocol-discovery') {
      const reachablePorts = connections
        .filter(connection => connection.sourceNodeId === model.id)
        .map(connection => connection.sourcePort)
      const reachableProtocols = reachablePorts
        .filter((protocol): protocol is WorkflowProtocol => WORKFLOW_PROTOCOLS.includes(protocol as WorkflowProtocol))
      const protocolEnumOptions = [...new Set(reachableProtocols)]

      addUniqueField(fields, {
        path: 'metadata.protocol',
        valueType: 'enum',
        sourceNodeId: model.id,
        sourcePort: 'protocol',
        enumOptions: protocolEnumOptions,
      })
      addUniqueField(fields, {
        path: 'metadata.transport',
        valueType: 'enum',
        sourceNodeId: model.id,
        sourcePort: 'transport',
        enumOptions: [...WORKFLOW_TRANSPORTS],
      })
      addUniqueField(fields, {
        path: 'metadata.protocolOutput.protocol',
        valueType: 'enum',
        sourceNodeId: model.id,
        sourcePort: 'protocol',
        enumOptions: protocolEnumOptions,
      })
      addUniqueField(fields, {
        path: 'metadata.protocolOutput.transport',
        valueType: 'enum',
        sourceNodeId: model.id,
        sourcePort: 'transport',
        enumOptions: [...WORKFLOW_TRANSPORTS],
      })
      addUniqueField(fields, {
        path: 'metadata.protocolOutput.model',
        valueType: 'string',
        sourceNodeId: model.id,
        sourcePort: 'protocol',
      })
      addUniqueField(fields, {
        path: 'metadata.protocolOutput.messages',
        valueType: 'array',
        sourceNodeId: model.id,
        sourcePort: 'protocol',
      })
      continue
    }

    if (model.kind === 'queue-select') {
      addUniqueField(fields, {
        path: 'queueIds',
        valueType: 'array',
        sourceNodeId: model.id,
        sourcePort: 'out',
      })
      continue
    }
  }

  return {
    fields,
    recommendedOperators: DEFAULT_OPERATOR_SET,
    upstreamNodeIds: [...upstreamNodeIds].filter(nodeId => modelsById.has(nodeId)),
  }
}
