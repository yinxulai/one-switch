import { WorkflowGraphSchema } from './schemas'
import type { WorkflowGraph } from './types'

/**
 * 路由图的历史版本。
 *
 * 语义：**「保存」= 生成一个新版本**，而不是覆盖一份草稿；
 * 当前工作副本仍然存在 `routerStorageKey`（见 `graph-model.ts`），
 * 版本列表存在下面这个独立键里，两者互不影响 —— 刷新页面读工作副本，
 * 打开下拉读版本列表。
 */
export const routerVersionStorageKey = 'one-switch.router.graph.versions.v1'

/** 最多保留的版本数，超出后丢弃最旧的。 */
export const MAX_ROUTER_VERSIONS = 30

export interface RouterGraphVersion {
  /** `version-<时间戳>`，仅用于 React key */
  id: string
  /** 单调递增的版本号（v1、v2 …），与列表顺序解耦，裁剪旧版本后不会错位 */
  sequence: number
  /** 保存时间（ISO 8601） */
  savedAt: string
  /** 该版本的节点数量，用于列表摘要 */
  nodeCount: number
  graph: WorkflowGraph
}

/** 序列化整张图，用于判断两个版本内容是否一致。 */
function serializeGraph(graph: WorkflowGraph): string {
  return JSON.stringify(graph)
}

/** 内容是否与已有版本完全一致（用于避免「保存」产生重复版本）。 */
export function isSameGraph(left: WorkflowGraph, right: WorkflowGraph): boolean {
  return serializeGraph(left) === serializeGraph(right)
}

/** 下一个版本号：在最新版本上 +1；还没有版本时从 v1 开始。 */
export function nextSequence(versions: RouterGraphVersion[]): number {
  const latest = versions[0]
  if (!latest) return 1
  return Number.isFinite(latest.sequence) ? latest.sequence + 1 : versions.length + 1
}

/** 生成一个新版本快照。 */
export function createVersion(graph: WorkflowGraph, sequence: number, savedAt: Date = new Date()): RouterGraphVersion {
  return {
    id: `version-${savedAt.getTime()}`,
    sequence,
    savedAt: savedAt.toISOString(),
    nodeCount: graph.nodes.length,
    graph,
  }
}

/** 新版本置顶；超过上限时丢弃最旧的。 */
export function appendVersion(versions: RouterGraphVersion[], version: RouterGraphVersion, limit: number = MAX_ROUTER_VERSIONS): RouterGraphVersion[] {
  const bounded = Math.max(1, limit)
  return [version, ...versions].slice(0, bounded)
}

/**
 * 从存储里读出的原始数据里挑出合法版本。
 * 任何一项不合法（图结构不通过 schema、缺少保存时间）都静默丢弃，不影响其余版本。
 */
export function parseVersions(raw: unknown): RouterGraphVersion[] {
  if (!Array.isArray(raw)) return []

  const versions: RouterGraphVersion[] = []
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const savedAt = typeof record.savedAt === 'string' ? record.savedAt : null
    if (!savedAt) continue

    const parsed = WorkflowGraphSchema.safeParse(record.graph)
    if (!parsed.success) continue

    const graph = parsed.data as WorkflowGraph
    const sequence = typeof record.sequence === 'number' && Number.isFinite(record.sequence)
      ? record.sequence
      : versions.length + 1
    versions.push({
      id: typeof record.id === 'string' && record.id ? record.id : `version-${savedAt}`,
      sequence,
      savedAt,
      nodeCount: graph.nodes.length,
      graph,
    })
    if (versions.length >= MAX_ROUTER_VERSIONS) break
  }
  return versions
}

/** 读取历史版本；存储不可用或数据损坏时返回空列表。 */
export function readVersions(): RouterGraphVersion[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const cached = localStorage.getItem(routerVersionStorageKey)
    if (!cached) return []
    return parseVersions(JSON.parse(cached) as unknown)
  } catch {
    return []
  }
}

/** 写入历史版本；存储不可用时静默忽略（仅影响历史记录，不影响画布）。 */
export function writeVersions(versions: RouterGraphVersion[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(routerVersionStorageKey, JSON.stringify(versions))
  } catch {
    // 超出配额等情况：历史版本失败不应该阻断保存流程
  }
}

/** `2026-09-11 22:41`，列表里按保存时间倒序展示。 */
export function formatVersionTime(savedAt: string): string {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return savedAt
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
