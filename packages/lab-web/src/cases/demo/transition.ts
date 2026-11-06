import type { Edge, Node, XYPosition } from '@xyflow/react'

/**
 * 换步过渡（纯函数）。
 * - 同 id、同类型的元件跨步保留：沿用上一步的节点对象（保住 measured，不然 xyflow 会把它当新节点藏一帧再测量），
 *   位置由播放器逐帧插值从起点挪到终点——不能用 CSS transition，连线读的是 store 里的位置，会和元件脱开。
 * - 新出现的元件 / 连线淡入；消失的留一会儿淡出再移除。
 * - 连线的身份按端点（元件.端子 两两排序）判断：各步数据里的 e1、e2 编号各自为政，同一个 id 可能是不同的线。
 */

export interface NodeMove {
  id: string
  from: XYPosition
  to: XYPosition
}

export function edgeKey(edge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>): string {
  const a = `${edge.source}:${edge.sourceHandle ?? ''}`
  const b = `${edge.target}:${edge.targetHandle ?? ''}`
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export interface MergedNodes<T extends Node> {
  nodes: T[]
  moves: NodeMove[]
  entering: string[]
  leaving: string[]
}

/**
 * 把目标步的节点并进当前节点：保留下来的先放在起点（播放器再插值到终点），离开的标上 leave 留着淡出。
 * classOf 给每个目标节点算 className（高亮、淡显、入场）。
 */
export function mergeNodes<T extends Node>(previous: T[], target: T[], classOf: (node: T, entering: boolean) => string): MergedNodes<T> {
  const before = new Map(previous.map((node) => [node.id, node]))
  const targetIds = new Set(target.map((node) => node.id))
  const moves: NodeMove[] = []
  const entering: string[] = []
  const nodes = target.map((node) => {
    const old = before.get(node.id)
    if (old && old.type === node.type) {
      if (old.position.x !== node.position.x || old.position.y !== node.position.y) {
        moves.push({ id: node.id, from: old.position, to: node.position })
      }
      return { ...old, data: node.data, position: old.position, className: classOf(node, false) } as T
    }
    entering.push(node.id)
    return { ...node, className: classOf(node, true) } as T
  })
  const leaving = previous.filter((node) => !targetIds.has(node.id) && !node.className?.includes('demo-leave'))
  for (const node of leaving) nodes.push({ ...node, className: 'demo-leave', selectable: false } as T)
  return { nodes, moves, entering, leaving: leaving.map((node) => node.id) }
}

export function mergeEdges(previous: Edge[], target: Edge[]): { edges: Edge[]; leaving: string[] } {
  const before = new Map(previous.filter((edge) => !edge.className?.includes('demo-edge-leave')).map((edge) => [edgeKey(edge), edge]))
  const keys = new Set<string>()
  const edges = target.map((edge) => {
    const key = edgeKey(edge)
    keys.add(key)
    const old = before.get(key)
    return old ? { ...old, className: '' } : { ...edge, id: `demo-${key}`, className: 'demo-edge-enter' }
  })
  const leaving = [...before.entries()].filter(([key]) => !keys.has(key)).map(([, edge]) => edge)
  for (const edge of leaving) edges.push({ ...edge, className: 'demo-edge-leave' })
  return { edges, leaving: leaving.map((edge) => edge.id) }
}

/** 统一给连线定 id（按端点），初次进入演示时用 */
export function keyedEdges(edges: Edge[]): Edge[] {
  return edges.map((edge) => ({ ...edge, id: `demo-${edgeKey(edge)}`, type: 'stepBridge' }))
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** 第 t（0～1）帧时各移动元件的位置 */
export function interpolate(moves: NodeMove[], t: number): Map<string, XYPosition> {
  const k = ease(Math.min(1, Math.max(0, t)))
  return new Map(moves.map((move) => [move.id, { x: move.from.x + (move.to.x - move.from.x) * k, y: move.from.y + (move.to.y - move.from.y) * k }]))
}

/** 所有步骤电路的包围盒并集：打开演示时只适配一次视图，之后只动元件不动视口（元件对应关系才跟得住） */
export function unionBounds(positions: XYPosition[], size = { width: 180, height: 170 }): { x: number; y: number; width: number; height: number } {
  if (positions.length === 0) return { x: 0, y: 0, width: 400, height: 300 }
  const xs = positions.map((p) => p.x)
  const ys = positions.map((p) => p.y)
  // 四周留出叠加层（极性、电位、箭头标注）和气泡的位置
  const margin = { x: 60, y: 70 }
  const x = Math.min(...xs) - margin.x
  const y = Math.min(...ys) - margin.y
  return { x, y, width: Math.max(...xs) - x + size.width + margin.x, height: Math.max(...ys) - y + size.height + margin.y }
}
