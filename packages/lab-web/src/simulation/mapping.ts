import type { Node } from '@xyflow/react'
import type { CircuitNodeData } from '@/types/circuit'

export type DisplayMode = 'node' | 'element'

export interface SimulationNetPayload {
  name: string
  nodes: [string, string][]
}

export function applyOverlay(
  nodes: Node<CircuitNodeData>[],
  nets: SimulationNetPayload[],
  nodeVoltages: Record<string, number>,
  displayMode: DisplayMode,
  branchCurrents?: Record<string, number>,
  showBranchCurrentsGlobal?: boolean,
): Node<CircuitNodeData>[] {
  const handleNetMap = new Map<string, string>()
  for (const net of nets) {
    for (const [nodeId, handleId] of net.nodes) {
      handleNetMap.set(`${nodeId}:${handleId}`, net.name)
    }
  }

  const getNetVoltage = (nodeId: string, handleId: string): number | undefined => {
    const net = handleNetMap.get(`${nodeId}:${handleId}`)
    if (!net) return undefined
    const v = nodeVoltages[net]
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  }

  const elementVoltagePN = (n: Node<CircuitNodeData>, pId: string, nId: string): number | undefined => {
    const vp = getNetVoltage(n.id, pId)
    const vn = getNetVoltage(n.id, nId)
    if (vp === undefined || vn === undefined) return undefined
    const delta = vp - vn
    return Number.isFinite(delta) ? delta : undefined
  }

  const sourceVoltagesPN = (
    n: Node<CircuitNodeData>,
    posId: string,
    negId: string,
  ): { voltage?: number; voltageDelta?: number } => {
    const vpos = getNetVoltage(n.id, posId)
    const vneg = getNetVoltage(n.id, negId)
    const delta = vpos !== undefined && vneg !== undefined ? vpos - vneg : undefined
    const voltage = displayMode === 'node' ? vpos : delta !== undefined ? delta : undefined
    const voltageDelta = delta !== undefined && Number.isFinite(delta) ? delta : undefined
    return { voltage, voltageDelta }
  }

  return nodes.map((node) => {
    let voltage: number | undefined
    let voltageDelta: number | undefined
    let current: number | undefined

    // 尝试获取支路电流
    // 电流探针总是显示电流（如果有数据）；其他元件仅在全局开关打开时显示电流
    if (branchCurrents && branchCurrents[node.id] !== undefined) {
      if (node.type === 'current_probe' || showBranchCurrentsGlobal) {
        current = branchCurrents[node.id]
      }
    }

    switch (node.type) {
      case 'ground': {
        voltage = 0
        break
      }
      case 'voltage_probe': {
        const v = getNetVoltage(node.id, 'node')
        voltage = v
        break
      }
      case 'current_probe': {
        if (current !== undefined) {
          voltage = undefined
        } else {
          if (displayMode === 'element') {
            voltage = elementVoltagePN(node, 'p', 'n')
          } else {
            voltage = getNetVoltage(node.id, 'p')
          }
        }
        break
      }
      case 'resistor':
      case 'capacitor':
      case 'inductor': {
        if (displayMode === 'element') {
          voltage = elementVoltagePN(node, 'p', 'n')
        } else {
          voltage = getNetVoltage(node.id, 'p')
        }
        break
      }
      case 'isource_dc':
      case 'isource_ac': {
        const src = sourceVoltagesPN(node, 'pos', 'neg')
        voltage = src.voltage
        voltageDelta = src.voltageDelta
        break
      }
      case 'vsource_dc':
      case 'vsource_ac': {
        const src = sourceVoltagesPN(node, 'pos', 'neg')
        voltage = src.voltage
        voltageDelta = src.voltageDelta
        break
      }
      case 'vcvs':
      case 'ccvs':
      case 'vccs':
      case 'cccs': {
        if (displayMode === 'element') {
          voltage = elementVoltagePN(node, 'pos', 'neg')
        } else {
          voltage = getNetVoltage(node.id, 'pos')
        }
        break
      }
      default: {
        break
      }
    }

    if (
      node.data.voltage === voltage &&
      node.data.voltageDelta === voltageDelta &&
      node.data.current === current
    ) {
      return node
    }

    return {
      ...node,
      data: {
        ...node.data,
        voltage,
        voltageDelta,
        current,
      },
    }
  })
}

