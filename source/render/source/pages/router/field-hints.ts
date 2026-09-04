import {
  DEFAULT_OPERATOR_SET,
  type ConfigHints,
  type SchemaFieldDescriptor,
  type SchemaValueType,
  type WorkflowNodeModel,
  type WorkflowProtocol,
} from './types'

export const WORKFLOW_PROTOCOLS: WorkflowProtocol[] = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'unknown',
]

export interface WorkflowConnection {
  sourceNodeId: string
  sourcePort: string
  targetNodeId: string
}

export interface InputHintResult extends ConfigHints {
  upstreamNodeIds: string[]
}

export function buildWorkflowConnections(models: WorkflowNodeModel[]): WorkflowConnection[] {
  const connections: WorkflowConnection[] = []

  for (const model of models) {
    if (model.kind === 'output') continue

    if (model.kind === 'input' || model.kind === 'control-input' || model.kind === 'resolver') {
      connections.push({ sourceNodeId: model.id, sourcePort: 'out', targetNodeId: model.next })
      continue
    }

    if (model.kind === 'condition') {
      for (const caseNode of model.cases) {
        connections.push({ sourceNodeId: model.id, sourcePort: caseNode.id, targetNodeId: caseNode.next })
      }
      connections.push({ sourceNodeId: model.id, sourcePort: 'else', targetNodeId: model.elseNext })
      continue
    }

    for (const protocol of WORKFLOW_PROTOCOLS) {
      connections.push({
        sourceNodeId: model.id,
        sourcePort: protocol,
        targetNodeId: model.branches[protocol],
      })
    }
  }

  return connections
}

function inferType(value: unknown): SchemaValueType {
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

function collectUpstreamConnections(models: WorkflowNodeModel[], targetNodeId: string): {
  connections: WorkflowConnection[]
  upstreamNodeIds: Set<string>
} {
  const knownNodeIds = new Set(models.map(model => model.id))
  const incoming = new Map<string, WorkflowConnection[]>()

  for (const connection of buildWorkflowConnections(models)) {
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

export function resolveInputHints(models: WorkflowNodeModel[], targetNodeId: string, samplePayload: unknown): InputHintResult {
  const { connections, upstreamNodeIds } = collectUpstreamConnections(models, targetNodeId)
  const modelsById = new Map(models.map(model => [model.id, model]))
  const fields: SchemaFieldDescriptor[] = []

  for (const model of models) {
    if (!upstreamNodeIds.has(model.id)) continue

    if (model.kind === 'input') {
      for (const field of flattenFields(samplePayload, '', model.id, 'context')) addUniqueField(fields, field)
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
        .filter((port): port is WorkflowProtocol => WORKFLOW_PROTOCOLS.includes(port as WorkflowProtocol))
      addUniqueField(fields, {
        path: 'metadata.protocol',
        valueType: 'enum',
        sourceNodeId: model.id,
        sourcePort: 'protocol',
        enumOptions: [...new Set(reachablePorts)],
      })
      continue
    }

    if (model.kind === 'resolver') {
      addUniqueField(fields, {
        path: `metadata.resolutions.${model.id}.selectedId`,
        valueType: 'string',
        sourceNodeId: model.id,
        sourcePort: 'resolution',
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
