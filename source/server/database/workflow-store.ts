import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { generateId, now } from '@common/utils'
import { getDb } from './index'
import { workflows } from './schema'

export interface WorkflowRecord {
  id: string
  type: string
  version: number
  name: string
  definition: unknown
  createdTime: number
  updatedTime: number
  deletedTime: number | null
}

type WorkflowRow = typeof workflows.$inferSelect

function parseWorkflow(row: WorkflowRow): WorkflowRecord {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    name: row.name,
    definition: JSON.parse(row.definition) as unknown,
    createdTime: Number(row.createdTime),
    updatedTime: Number(row.updatedTime),
    deletedTime: row.deletedTime === null ? null : Number(row.deletedTime),
  }
}

export async function listWorkflows(includeDeleted = false): Promise<WorkflowRecord[]> {
  const rows = getDb().select().from(workflows).where(includeDeleted ? undefined : isNull(workflows.deletedTime)).orderBy(asc(workflows.type), desc(workflows.version)).all()
  return rows.map(parseWorkflow)
}

export async function getWorkflow(type: string, version: number): Promise<WorkflowRecord | undefined> {
  const row = getDb().select().from(workflows).where(and(eq(workflows.type, type), eq(workflows.version, version))).get()
  return row ? parseWorkflow(row) : undefined
}

export async function getLatestWorkflow(type: string): Promise<WorkflowRecord | undefined> {
  const row = getDb().select().from(workflows).where(and(eq(workflows.type, type), isNull(workflows.deletedTime))).orderBy(desc(workflows.version), desc(workflows.updatedTime)).get()
  return row ? parseWorkflow(row) : undefined
}

export async function createWorkflow(input: Omit<WorkflowRecord, 'id' | 'createdTime' | 'updatedTime' | 'deletedTime'>): Promise<WorkflowRecord> {
  const time = now()
  const workflow: WorkflowRecord = {
    id: generateId('workflow_'),
    type: input.type,
    version: input.version,
    name: input.name,
    definition: input.definition,
    createdTime: time,
    updatedTime: time,
    deletedTime: null,
  }
  getDb().insert(workflows).values({
    id: workflow.id,
    type: workflow.type,
    version: workflow.version,
    name: workflow.name,
    definition: JSON.stringify(workflow.definition),
    createdTime: workflow.createdTime,
    updatedTime: workflow.updatedTime,
    deletedTime: workflow.deletedTime,
  }).run()
  return workflow
}

export async function updateWorkflow(id: string, updates: Partial<Omit<WorkflowRecord, 'id' | 'type' | 'version' | 'createdTime'>>): Promise<WorkflowRecord> {
  const existing = getDb().select().from(workflows).where(eq(workflows.id, id)).get()
  if (!existing) throw new Error(`workflow not found: ${id}`)
  const next: WorkflowRecord = {
    ...parseWorkflow(existing),
    ...updates,
    id,
    type: existing.type,
    version: existing.version,
    updatedTime: now(),
  }
  getDb().update(workflows).set({
    name: next.name,
    definition: JSON.stringify(next.definition),
    updatedTime: next.updatedTime,
    deletedTime: next.deletedTime,
  }).where(eq(workflows.id, id)).run()
  return next
}

export async function deleteWorkflow(id: string): Promise<void> {
  const time = now()
  getDb().update(workflows).set({ deletedTime: time, updatedTime: time }).where(eq(workflows.id, id)).run()
}
