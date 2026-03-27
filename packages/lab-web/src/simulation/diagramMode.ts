import type { Node } from '@xyflow/react'

import { circuitComponentLibrary } from '@/circuit/components'
import type { CircuitNodeData } from '@/types/circuit'
import {
  BRIDGE_COMPONENT_TYPES,
  CONTROL_COMPONENT_TYPES,
  type BridgeComponentType,
  type ControlComponentType,
  type DiagramMode,
} from '@/types/control'

const controlComponentTypeSet = new Set<string>(CONTROL_COMPONENT_TYPES)
const bridgeComponentTypeSet = new Set<string>(BRIDGE_COMPONENT_TYPES)

export function isControlComponentType(type: string): type is ControlComponentType {
  return controlComponentTypeSet.has(type)
}

export function isBridgeComponentType(type: string): type is BridgeComponentType {
  return bridgeComponentTypeSet.has(type)
}

export function isElectricalComponentType(type: string): boolean {
  return type in circuitComponentLibrary && !isControlComponentType(type) && !isBridgeComponentType(type)
}

export function detectDiagramMode(nodes: Node<CircuitNodeData>[]): DiagramMode {
  if (nodes.length === 0) return 'empty'

  let hasControl = false
  let hasElectrical = false
  let hasBridge = false

  for (const node of nodes) {
    const type = String(node.type ?? '')
    if (isControlComponentType(type)) {
      hasControl = true
      continue
    }
    if (isBridgeComponentType(type)) {
      hasBridge = true
      continue
    }
    if (isElectricalComponentType(type)) {
      hasElectrical = true
    }
  }

  if (hasBridge) {
    return 'mixed'
  }
  if (hasControl && hasElectrical) return 'mixed'
  if (hasControl) return 'control'
  return 'electrical'
}
