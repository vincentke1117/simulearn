import type { Edge, Node } from '@xyflow/react'

import { circuitComponentLibrary } from '@/circuit/components'
import type { CircuitNodeData, MixedSimulationPayload, SimulationNetPayload } from '@/types/circuit'
import { CONTROL_DYNAMIC_COMPONENT_TYPES, type SignalBlockType } from '@/types/control'
import {
  isBridgeComponentType,
  isControlComponentType,
  isElectricalComponentType,
} from '@/simulation/diagramMode'

interface SignalHandleSchema {
  inputs: string[]
  outputs: string[]
}

const signalHandleSchema: Record<SignalBlockType, SignalHandleSchema> = {
  control_step: { inputs: [], outputs: ['out'] },
  control_constant: { inputs: [], outputs: ['out'] },
  control_sum: { inputs: ['in1', 'in2'], outputs: ['out'] },
  control_gain: { inputs: ['in'], outputs: ['out'] },
  control_integrator: { inputs: ['in'], outputs: ['out'] },
  control_plant_1st: { inputs: ['in'], outputs: ['out'] },
  control_pid: { inputs: ['in'], outputs: ['out'] },
  control_scope: { inputs: ['in'], outputs: [] },
  voltage_sensor: { inputs: [], outputs: ['out'] },
  current_sensor: { inputs: [], outputs: ['out'] },
  controlled_voltage_source: { inputs: ['in'], outputs: [] },
  controlled_current_source: { inputs: ['in'], outputs: [] },
}

class DisjointSet<T extends string> {
  private parent = new Map<T, T>()
  private rank = new Map<T, number>()

  add(value: T) {
    if (!this.parent.has(value)) {
      this.parent.set(value, value)
      this.rank.set(value, 0)
    }
  }

  find(value: T): T {
    const parent = this.parent.get(value)
    if (!parent || parent === value) return value
    const root = this.find(parent)
    this.parent.set(value, root)
    return root
  }

  union(a: T, b: T) {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return

    const rankA = this.rank.get(rootA) ?? 0
    const rankB = this.rank.get(rootB) ?? 0
    if (rankA < rankB) {
      this.parent.set(rootA, rootB)
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA)
    } else {
      this.parent.set(rootB, rootA)
      this.rank.set(rootA, rankA + 1)
    }
  }

  groups(): Map<T, T[]> {
    const result = new Map<T, T[]>()
    for (const key of this.parent.keys()) {
      const root = this.find(key)
      const group = result.get(root)
      if (group) group.push(key)
      else result.set(root, [key])
    }
    return result
  }
}

function handleKey(nodeId: string, handleId: string) {
  return `${nodeId}:${handleId}`
}

function stronglyConnectedComponents(nodeIds: string[], graph: Map<string, Set<string>>): string[][] {
  const indices = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []
  let index = 0

  const visit = (nodeId: string) => {
    indices.set(nodeId, index)
    lowLinks.set(nodeId, index)
    index += 1
    stack.push(nodeId)
    onStack.add(nodeId)

    for (const neighbor of graph.get(nodeId) ?? new Set<string>()) {
      if (!indices.has(neighbor)) {
        visit(neighbor)
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, lowLinks.get(neighbor)!))
      } else if (onStack.has(neighbor)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, indices.get(neighbor)!))
      }
    }

    if (lowLinks.get(nodeId) === indices.get(nodeId)) {
      const component: string[] = []
      while (stack.length > 0) {
        const node = stack.pop()!
        onStack.delete(node)
        component.push(node)
        if (node === nodeId) break
      }
      components.push(component)
    }
  }

  for (const nodeId of nodeIds) {
    if (!indices.has(nodeId)) visit(nodeId)
  }
  return components
}

type HandleDomain = 'signal' | 'electrical'

function getHandleDomain(type: string, handleId: string): HandleDomain | null {
  if (isControlComponentType(type)) {
    const schema = signalHandleSchema[type]
    return schema.inputs.includes(handleId) || schema.outputs.includes(handleId) ? 'signal' : null
  }
  if (isBridgeComponentType(type)) {
    const schema = signalHandleSchema[type]
    if (schema.inputs.includes(handleId) || schema.outputs.includes(handleId)) return 'signal'
    if (type === 'voltage_sensor' || type === 'current_sensor') {
      return handleId === 'p' || handleId === 'n' ? 'electrical' : null
    }
    return handleId === 'pos' || handleId === 'neg' ? 'electrical' : null
  }
  if (isElectricalComponentType(type)) {
    const definition = circuitComponentLibrary[type as keyof typeof circuitComponentLibrary]
    return definition?.handles.some((handle) => handle.id === handleId) ? 'electrical' : null
  }
  return null
}

function isSignalOutput(type: string, handleId: string) {
  return (isControlComponentType(type) || isBridgeComponentType(type))
    && signalHandleSchema[type].outputs.includes(handleId)
}

function isSignalInput(type: string, handleId: string) {
  return (isControlComponentType(type) || isBridgeComponentType(type))
    && signalHandleSchema[type].inputs.includes(handleId)
}

function buildElectricalNets(nodes: Node<CircuitNodeData>[], electricalEdges: Edge[]) {
  const errors: string[] = []
  const disjointSet = new DisjointSet<string>()

  for (const edge of electricalEdges) {
    if (!edge.sourceHandle || !edge.targetHandle) {
      errors.push(`连线 ${edge.id} 缺少端口信息`)
      continue
    }
    const sourceKey = handleKey(edge.source, edge.sourceHandle)
    const targetKey = handleKey(edge.target, edge.targetHandle)
    disjointSet.add(sourceKey)
    disjointSet.add(targetKey)
    disjointSet.union(sourceKey, targetKey)
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const nets: SimulationNetPayload[] = []
  const handleNetMap = new Map<string, string>()
  let netIndex = 1
  let gndAssigned = false

  for (const [, groupHandles] of disjointSet.groups()) {
    const members: [string, string][] = []
    let hasGround = false

    for (const key of groupHandles) {
      const [nodeId, handleId] = key.split(':')
      const node = nodeMap.get(nodeId)
      if (!node) {
        errors.push(`连线引用了不存在的元件 ${nodeId}`)
        continue
      }
      const definition = circuitComponentLibrary[node.type as keyof typeof circuitComponentLibrary]
      if (!definition) {
        errors.push(`连线引用了未知元件类型 ${String(node.type)}`)
        continue
      }
      if (!definition.handles.some((handle) => handle.id === handleId)) {
        errors.push(`${node.id} 不存在端子 ${handleId}`)
        continue
      }
      members.push([nodeId, handleId])
      if (node.type === 'ground') hasGround = true
    }

    if (members.length < 2) {
      errors.push(`网络 ${hasGround ? 'gnd' : 'n?'} 只有 ${members.length} 个端子，无法仿真`)
      continue
    }

    let name: string
    if (hasGround && !gndAssigned) {
      name = 'gnd'
      gndAssigned = true
    } else if (hasGround && gndAssigned) {
      errors.push('存在多个地线网络，请将所有地线连接到同一网络')
      name = `n${netIndex++}`
    } else {
      name = `n${netIndex++}`
    }
    nets.push({ name, nodes: members })
    for (const [nodeId, handleId] of members) handleNetMap.set(handleKey(nodeId, handleId), name)
  }
  return { nets, handleNetMap, errors }
}

export interface MixedTopologyAnalysis {
  errors: string[]
  nets: SimulationNetPayload[]
  signalEdges: MixedSimulationPayload['edges']
  missingSignalInputs: Array<{ blockId: string; input: string }>
  algebraicLoops: string[][]
  netFor(nodeId: string, handleId: string): string | undefined
}

export function analyzeMixedTopology(
  nodes: Node<CircuitNodeData>[],
  edges: Edge[],
): MixedTopologyAnalysis {
  const errors: string[] = []
  const electricalEdges: Edge[] = []
  const signalEdges: MixedSimulationPayload['edges'] = []
  const incomingByTarget = new Map<string, Edge[]>()
  const adjacency = new Map<string, Set<string>>()
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))

  for (const node of nodes) {
    const type = String(node.type ?? '')
    if (isControlComponentType(type) || isBridgeComponentType(type)) adjacency.set(node.id, new Set())
  }

  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) {
      errors.push(`连线 ${edge.id} 缺少端口信息`)
      continue
    }
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    if (!sourceNode || !targetNode) {
      errors.push(`连线 ${edge.id} 引用了不存在的元件`)
      continue
    }
    const sourceType = String(sourceNode.type ?? '')
    const targetType = String(targetNode.type ?? '')
    const sourceDomain = getHandleDomain(sourceType, edge.sourceHandle)
    const targetDomain = getHandleDomain(targetType, edge.targetHandle)
    if (!sourceDomain || !targetDomain) {
      errors.push(`连线 ${edge.id} 使用了未知端口类型`)
      continue
    }
    if (sourceDomain !== targetDomain) {
      errors.push(`连线 ${edge.id} 不能跨域连接（电气端口与信号端口不能直接相连）`)
      continue
    }
    if (sourceDomain === 'electrical') {
      electricalEdges.push(edge)
      continue
    }
    if (!isSignalOutput(sourceType, edge.sourceHandle)) {
      errors.push(`连线 ${edge.id} 的 sourceHandle ${edge.sourceHandle} 不是信号输出端`)
      continue
    }
    if (!isSignalInput(targetType, edge.targetHandle)) {
      errors.push(`连线 ${edge.id} 的 targetHandle ${edge.targetHandle} 不是信号输入端`)
      continue
    }

    const incomingKey = handleKey(edge.target, edge.targetHandle)
    const incoming = incomingByTarget.get(incomingKey) ?? []
    incoming.push(edge)
    incomingByTarget.set(incomingKey, incoming)
    if (incoming.length > 1) errors.push(`${edge.target} 的端口 ${edge.targetHandle} 不能连接多条输入线`)
    adjacency.get(edge.source)?.add(edge.target)
    signalEdges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })
  }

  const netAnalysis = buildElectricalNets(nodes, electricalEdges)
  errors.push(...netAnalysis.errors)

  const signalNodes = nodes.filter((node) => {
    const type = String(node.type ?? '')
    return isControlComponentType(type) || isBridgeComponentType(type)
  })
  const missingSignalInputs: Array<{ blockId: string; input: string }> = []
  for (const node of signalNodes) {
    const type = String(node.type ?? '') as SignalBlockType
    for (const input of signalHandleSchema[type].inputs) {
      if (!incomingByTarget.has(handleKey(node.id, input))) missingSignalInputs.push({ blockId: node.id, input })
    }
  }

  const blockTypeById = new Map(signalNodes.map((node) => [node.id, String(node.type ?? '')]))
  const algebraicLoops = stronglyConnectedComponents(signalNodes.map((node) => node.id), adjacency).filter((component) => {
    const isSelfCycle = component.length === 1 && (adjacency.get(component[0])?.has(component[0]) ?? false)
    if (component.length === 1 && !isSelfCycle) return false
    return !component.some((nodeId) => {
      const type = blockTypeById.get(nodeId)
      return Boolean(type && isControlComponentType(type) && CONTROL_DYNAMIC_COMPONENT_TYPES.has(type))
    })
  })

  return {
    errors,
    nets: netAnalysis.nets,
    signalEdges,
    missingSignalInputs,
    algebraicLoops,
    netFor: (nodeId, handleId) => netAnalysis.handleNetMap.get(handleKey(nodeId, handleId)),
  }
}
