import type { Node } from '@xyflow/react'

import type { CircuitComponentDefinition } from '@/circuit/components'
import type { CircuitNodeData } from '@/types/circuit'

export function nextComponentId(
  counters: Record<string, number>,
  definition: CircuitComponentDefinition,
): { id: string; nextCounters: Record<string, number> } {
  const current = counters[definition.type] ?? 0
  const next = current + 1
  return {
    id: `${definition.prefix}${next}`,
    nextCounters: {
      ...counters,
      [definition.type]: next,
    },
  }
}

export function rebuildCountersFromNodes(nodes: Node<CircuitNodeData>[]): Record<string, number> {
  const counters: Record<string, number> = {}
  for (const node of nodes) {
    const match = node.id.match(/(\d+)$/)
    if (!match) continue
    const value = Number(match[1])
    if (!Number.isFinite(value)) continue
    const typeKey = node.data.type
    counters[typeKey] = Math.max(counters[typeKey] ?? 0, value)
  }
  return counters
}

// 基于当前画布已有节点，计算给定元件类型的下一个安全编号。
// 该方法可避免在 StrictMode 下因函数式 setState 被调用两次而导致计数自增两次的问题。
export function nextComponentIdFromNodes(
  nodes: Node<CircuitNodeData>[],
  definition: CircuitComponentDefinition,
): string {
  let maxSuffix = 0
  for (const node of nodes) {
    if (node.type !== definition.type) continue
    const match = node.id.match(/(\d+)$/)
    if (!match) continue
    const value = Number(match[1])
    if (!Number.isFinite(value)) continue
    if (value > maxSuffix) maxSuffix = value
  }
  return `${definition.prefix}${maxSuffix + 1}`
}
