import type { Edge, Node } from '@xyflow/react'

import type { CaseLibrary } from '@/cases/types'
import { loadExamples } from '@/examples/registry'
import type { CircuitNodeData } from '@/types/circuit'
import { buildProjectSnapshot, loadProjectFromObject } from '@/workspace/project'
import { circuitSignature, resolveProject, type LoadMessage } from './protocol'
import { pageStorage } from './storage'

export interface EmbedCircuit {
  nodes: Node<CircuitNodeData>[]
  edges: Edge[]
}

function fromProject(project: unknown): EmbedCircuit {
  const result = loadProjectFromObject(project)
  if (!result.ok || !result.nodes || !result.edges) {
    throw new Error(`实验电路读不出来：${result.errors.join('；') || '格式不对'}`)
  }
  // 与「导入项目」一致：连线统一用带跳弧的 stepBridge
  return { nodes: result.nodes, edges: result.edges.map((edge) => ({ ...edge, type: 'stepBridge' })) }
}

/** load.project → 画布上的电路：工程文件信封直接拆，{"example": id} 去内置示例里找 */
export async function resolveCircuit(load: LoadMessage): Promise<EmbedCircuit> {
  const resolved = resolveProject(load.project)
  if (resolved.kind === 'error') throw new Error(resolved.message)
  if (resolved.kind === 'library') throw new Error('这是案例库，不是单个电路')
  if (resolved.kind === 'project') return fromProject(resolved.project)
  const example = (await loadExamples()).find((item) => item.id === resolved.id)
  if (!example) throw new Error(`没有名为 ${resolved.id} 的内置示例电路`)
  return fromProject(example.data)
}

export type EmbedTarget =
  | { kind: 'circuit'; circuit: EmbedCircuit }
  | { kind: 'library'; library: CaseLibrary }

/** load.project → 单个电路，或学生自己挑案例的案例库 */
export async function resolveEmbedTarget(load: LoadMessage): Promise<EmbedTarget> {
  const resolved = resolveProject(load.project)
  if (resolved.kind !== 'library') return { kind: 'circuit', circuit: await resolveCircuit(load) }
  // 案例数据只在打开案例库时才加载，单个电路的实验不必带上它
  const { findLibrary } = await import('@/cases/library')
  const library = findLibrary(resolved.id)
  if (!library) throw new Error(`没有名为 ${resolved.id} 的案例库`)
  return { kind: 'library', library }
}

/**
 * 嵌入模式的草稿：和课程电路的指纹绑在一起，电路改了版就不再恢复。
 * 只存学生真改过的（电气内容和初始电路不同）；改回原样就删掉，下次直接给初始电路。
 * 存在 pageStorage 里：嵌入知帆时是内核镜像（客户端重开还在），见 storage.ts。
 */
const DRAFT_KEY = 'draft-v1'

interface StoredDraft {
  fingerprint: string
  project: ReturnType<typeof buildProjectSnapshot>
}

export function readDraft(prefix: string, fingerprint: string): EmbedCircuit | null {
  try {
    const saved = JSON.parse(pageStorage.getItem(prefix + DRAFT_KEY) ?? 'null') as StoredDraft | null
    if (!saved || saved.fingerprint !== fingerprint) return null
    return fromProject(saved.project)
  } catch {
    return null // 草稿损坏就用初始电路
  }
}

export function writeDraft(
  prefix: string,
  fingerprint: string,
  baseline: string,
  nodes: Node<CircuitNodeData>[],
  edges: Edge[],
): void {
  try {
    if (circuitSignature(nodes, edges) === baseline) {
      pageStorage.removeItem(prefix + DRAFT_KEY)
      return
    }
    const draft: StoredDraft = { fingerprint, project: buildProjectSnapshot(nodes, edges) }
    pageStorage.setItem(prefix + DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // 存储满了或被禁用：草稿只是方便，不影响实验本身
  }
}

/** 案例列表上标「改过参数」用：有草稿、而且是这一版电路的草稿（指纹对得上，打开时才真会恢复） */
export function hasDraft(prefix: string, fingerprint: string): boolean {
  try {
    const saved = JSON.parse(pageStorage.getItem(prefix + DRAFT_KEY) ?? 'null') as StoredDraft | null
    return saved?.fingerprint === fingerprint
  } catch {
    return false
  }
}

export function clearDraft(prefix: string): void {
  try {
    pageStorage.removeItem(prefix + DRAFT_KEY)
  } catch {
    // 同上
  }
}
