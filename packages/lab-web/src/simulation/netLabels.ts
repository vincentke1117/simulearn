import type { Node } from '@xyflow/react'

import type { CircuitNodeData } from '@/types/circuit'
import type { SimulationNetPayload } from './mapping'

/**
 * 结果表里的网络名（n1、n2…）是构造请求时按连通关系临时编的，画布上看不到。
 * 给每个网络配一个学生对得上的说明：挂了电压探针就用探针名，接地的叫「地」，
 * 否则列出接在上面的头两个元件端子（R1.p、R2.n）。
 */
export function describeNets(nodes: Node<CircuitNodeData>[], nets: SimulationNetPayload[]): Record<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const labels: Record<string, string> = {}
  for (const net of nets) {
    const members = net.nodes.map(([id, handle]) => ({ node: byId.get(id), handle }))
    const probes = members.filter((member) => member.node?.type === 'voltage_probe').map((member) => member.node!.data.label)
    if (probes.length > 0) {
      labels[net.name] = `探针 ${probes.join('、')}`
    } else if (members.some((member) => member.node?.type === 'ground') || net.name === 'gnd') {
      labels[net.name] = '地'
    } else {
      const terminals = members
        .filter((member) => member.node)
        .slice(0, 2)
        .map((member) => `${member.node!.data.label}.${member.handle}`)
      labels[net.name] = terminals.join('、') + (members.length > 2 ? ' 等' : '')
    }
  }
  return labels
}

/** 支路行名：元件 id 后面括上画布标签（两者相同就只写一次） */
export function componentRowLabel(id: string, labels?: Record<string, string>): string {
  const label = labels?.[id]
  return label && label !== id ? `${id}（${label}）` : id
}

/** 表格行名：网络名后面括上说明，没有说明就原样 */
export function withNetLabel(net: string, labels?: Record<string, string>): string {
  const label = labels?.[net]
  return label ? `${net}（${label}）` : net
}
