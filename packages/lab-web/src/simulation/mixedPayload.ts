import type { Edge, Node } from '@xyflow/react'

import { circuitComponentLibrary, type CircuitComponentType } from '@/circuit/components'
import type {
  CircuitNodeData,
  MixedSimulationPayload,
  SimulationNetPayload,
  SimulationSettings,
} from '@/types/circuit'
import { CONTROL_DYNAMIC_COMPONENT_TYPES, type SignalBlockType } from '@/types/control'
import {
  detectDiagramMode,
  isBridgeComponentType,
  isControlComponentType,
  isElectricalComponentType,
} from '@/simulation/diagramMode'

export interface BuildMixedSimulationPayloadResult {
  ok: boolean
  payload?: MixedSimulationPayload
  errors: string[]
}

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

const supportedMixedElectricalTypes = new Set([
  'resistor',
  'vsource_dc',
  'isource_dc',
  'vcvs',
  'ccvs',
  'vccs',
  'cccs',
  'ground',
  'voltage_probe',
  'current_probe',
])

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
    if (!parent || parent === value) {
      return value
    }
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
      if (group) {
        group.push(key)
      } else {
        result.set(root, [key])
      }
    }
    return result
  }
}

function ensureFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function handleKey(nodeId: string, handleId: string) {
  return `${nodeId}:${handleId}` as const
}

function incomingKey(nodeId: string, handleId: string) {
  return `${nodeId}:${handleId}`
}

function stronglyConnectedComponents(
  nodeIds: string[],
  graph: Map<string, Set<string>>,
): string[][] {
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

    const neighbors = graph.get(nodeId) ?? new Set<string>()
    for (const neighbor of neighbors) {
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
    if (!indices.has(nodeId)) {
      visit(nodeId)
    }
  }

  return components
}

type HandleDomain = 'signal' | 'electrical'

function getHandleDomain(type: string, handleId: string): HandleDomain | null {
  if (isControlComponentType(type)) {
    const schema = signalHandleSchema[type]
    if (schema.inputs.includes(handleId) || schema.outputs.includes(handleId)) return 'signal'
    return null
  }
  if (isBridgeComponentType(type)) {
    const schema = signalHandleSchema[type]
    if (schema.inputs.includes(handleId) || schema.outputs.includes(handleId)) return 'signal'
    if (type === 'voltage_sensor' || type === 'current_sensor') {
      return handleId === 'p' || handleId === 'n' ? 'electrical' : null
    }
    if (type === 'controlled_voltage_source' || type === 'controlled_current_source') {
      return handleId === 'pos' || handleId === 'neg' ? 'electrical' : null
    }
    return null
  }
  if (isElectricalComponentType(type)) {
    const definition = circuitComponentLibrary[type as keyof typeof circuitComponentLibrary]
    if (!definition) return null
    return definition.handles.some((handle) => handle.id === handleId) ? 'electrical' : null
  }
  return null
}

function isSignalOutput(type: string, handleId: string): boolean {
  if (!isControlComponentType(type) && !isBridgeComponentType(type)) return false
  return signalHandleSchema[type].outputs.includes(handleId)
}

function isSignalInput(type: string, handleId: string): boolean {
  if (!isControlComponentType(type) && !isBridgeComponentType(type)) return false
  return signalHandleSchema[type].inputs.includes(handleId)
}

function buildElectricalNets(
  nodes: Node<CircuitNodeData>[],
  electricalEdges: Edge[],
): {
  nets: SimulationNetPayload[]
  handleNetMap: Map<string, string>
  errors: string[]
} {
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

      const handleExists = definition.handles.some((handle) => handle.id === handleId)
      if (!handleExists) {
        errors.push(`${node.id} 不存在端子 ${handleId}`)
        continue
      }

      members.push([nodeId, handleId])
      if (node.type === 'ground') {
        hasGround = true
      }
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
    for (const member of members) {
      handleNetMap.set(handleKey(member[0], member[1]), name)
    }
  }

  return { nets, handleNetMap, errors }
}

export function buildMixedSimulationPayload(
  nodes: Node<CircuitNodeData>[],
  edges: Edge[],
  settings: SimulationSettings,
): BuildMixedSimulationPayloadResult {
  const errors: string[] = []

  if (!(settings.tStop > 0)) {
    errors.push('仿真时长必须大于 0')
  }
  if (!Number.isInteger(settings.nSamples) || settings.nSamples < 2) {
    errors.push('采样点数至少为 2 且必须为整数')
  }

  if (nodes.length === 0) {
    errors.push('请先在画布中放置元件')
    return { ok: false, errors }
  }

  const mode = detectDiagramMode(nodes)
  if (mode !== 'mixed') {
    errors.push('当前画布不是混合图（电路+控制）')
    return { ok: false, errors }
  }

  const nodeMap = new Map<string, Node<CircuitNodeData>>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
  }

  const electricalEdges: Edge[] = []
  const signalEdges: MixedSimulationPayload['edges'] = []
  const incomingByTarget = new Map<string, Edge[]>()
  const adjacency = new Map<string, Set<string>>()

  for (const node of nodes) {
    const type = String(node.type ?? '')
    if (isControlComponentType(type) || isBridgeComponentType(type)) {
      adjacency.set(node.id, new Set<string>())
    }
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

    const incoming = incomingByTarget.get(incomingKey(edge.target, edge.targetHandle)) ?? []
    incoming.push(edge)
    incomingByTarget.set(incomingKey(edge.target, edge.targetHandle), incoming)
    if (incoming.length > 1) {
      errors.push(`${edge.target} 的端口 ${edge.targetHandle} 不能连接多条输入线`)
    }

    adjacency.get(edge.source)?.add(edge.target)
    signalEdges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })
  }

  const { nets, handleNetMap, errors: netErrors } = buildElectricalNets(nodes, electricalEdges)
  errors.push(...netErrors)

  const circuitComponents: MixedSimulationPayload['circuit']['components'] = []
  const blocks: MixedSimulationPayload['blocks'] = []
  const bridgeBindings: MixedSimulationPayload['bridges'] = []
  const scopeNodes: Node<CircuitNodeData>[] = []

  let hasGround = false
  let hasElectricalSource = false
  let hasBridge = false
  let hasControl = false
  let hasElectricalProbe = false

  for (const node of nodes) {
    const type = String(node.type ?? '')
    const definition = circuitComponentLibrary[type as keyof typeof circuitComponentLibrary]
    if (!definition) {
      errors.push(`未知元件类型：${type}`)
      continue
    }

    if (isElectricalComponentType(type)) {
      if (!supportedMixedElectricalTypes.has(type)) {
        errors.push(`混合仿真暂不支持电气元件 ${node.id}（${type}），当前仅支持电阻/直流源/受控源/探针`)
        continue
      }

      const parameters: Record<string, number> = {}
      for (const parameter of definition.parameters) {
        const value = node.data.parameters[parameter.key]
        if (!ensureFiniteNumber(value) || (parameter.min !== undefined && value < parameter.min)) {
          errors.push(`${node.id} 的参数 ${parameter.label} 无效`)
          continue
        }
        parameters[parameter.key] = value
      }

      const connections: Record<string, string> = {}
      for (const handle of definition.handles) {
        const netName = handleNetMap.get(handleKey(node.id, handle.id))
        if (!netName) {
          errors.push(`${node.id} 的端子 ${handle.id} 未连接`)
          continue
        }
        connections[handle.id] = netName
      }

      if (node.type === 'ground') hasGround = true
      if (
        node.type === 'vsource_dc' ||
        node.type === 'isource_dc' ||
        node.type === 'vcvs' ||
        node.type === 'ccvs' ||
        node.type === 'vccs' ||
        node.type === 'cccs'
      ) {
        hasElectricalSource = true
      }
      if (node.type === 'voltage_probe' || node.type === 'current_probe') {
        hasElectricalProbe = true
      }

      if (node.type === 'switch') {
        const state = parameters['state'] ?? 0
        const resistance = state === 1 ? 1e-6 : 1e9
        circuitComponents.push({
          id: node.id,
          type: 'resistor',
          parameters: { value: resistance },
          connections,
        })
      } else {
        circuitComponents.push({
          id: node.id,
          type: type as CircuitComponentType,
          parameters,
          connections,
        })
      }
      continue
    }

    if (isControlComponentType(type) || isBridgeComponentType(type)) {
      const parameters: Record<string, number> = {}
      for (const parameter of definition.parameters) {
        const value = node.data.parameters[parameter.key]
        if (!ensureFiniteNumber(value) || (parameter.min !== undefined && value < parameter.min)) {
          errors.push(`${node.id} 的参数 ${parameter.label} 无效`)
          continue
        }
        parameters[parameter.key] = value
      }

      blocks.push({
        id: node.id,
        type,
        parameters,
      })

      if (type === 'control_scope') {
        scopeNodes.push(node)
      }
      if (isControlComponentType(type)) {
        hasControl = true
      }
      if (isBridgeComponentType(type)) {
        hasBridge = true
        if (type === 'voltage_sensor' || type === 'current_sensor') {
          const pNet = handleNetMap.get(handleKey(node.id, 'p'))
          const nNet = handleNetMap.get(handleKey(node.id, 'n'))
          if (!pNet || !nNet) {
            errors.push(`${node.id} 的电气端口 p/n 必须连接到电路网络`)
          } else {
            bridgeBindings.push({
              blockId: node.id,
              positiveNet: pNet,
              negativeNet: nNet,
            })
          }
        } else {
          const posNet = handleNetMap.get(handleKey(node.id, 'pos'))
          const negNet = handleNetMap.get(handleKey(node.id, 'neg'))
          if (!posNet || !negNet) {
            errors.push(`${node.id} 的电气端口 pos/neg 必须连接到电路网络`)
          } else {
            bridgeBindings.push({
              blockId: node.id,
              positiveNet: posNet,
              negativeNet: negNet,
            })
          }
          hasElectricalSource = true
        }
      }
      continue
    }

    errors.push(`元件 ${node.id} 类型不受支持`)
  }

  for (const block of blocks) {
    const schema = signalHandleSchema[block.type]
    for (const input of schema.inputs) {
      const key = incomingKey(block.id, input)
      if (!incomingByTarget.has(key)) {
        errors.push(`${block.id} 的信号端口 ${input} 未连接`)
      }
    }
  }

  const blockTypeById = new Map(blocks.map((block) => [block.id, block.type]))
  const signalNodeIds = blocks.map((block) => block.id)
  const sccs = stronglyConnectedComponents(signalNodeIds, adjacency)
  for (const component of sccs) {
    const isSelfCycle = component.length === 1 && (adjacency.get(component[0])?.has(component[0]) ?? false)
    const isCycle = component.length > 1 || isSelfCycle
    if (!isCycle) continue

    const hasDynamic = component.some((nodeId) => {
      const type = blockTypeById.get(nodeId)
      return Boolean(type && isControlComponentType(type) && CONTROL_DYNAMIC_COMPONENT_TYPES.has(type))
    })
    if (!hasDynamic) {
      errors.push(`检测到纯代数环：${component.join(' -> ')}。请在反馈环中加入动态环节`)
    }
  }

  if (!hasBridge) {
    errors.push('混合仿真至少需要一个桥接元件（传感器或受控源）')
  }
  if (!hasControl) {
    errors.push('混合仿真需要至少一个控制块（如 Step/Gain/PID）')
  }
  if (!hasGround) {
    errors.push('混合仿真电路侧缺少地线 (ground)')
  }
  if (!hasElectricalSource) {
    errors.push('混合仿真电路侧缺少激励源：请添加独立源或受控源')
  }

  if (scopeNodes.length === 0 && !hasElectricalProbe) {
    errors.push('请至少添加一个 control_scope 或电气探针作为输出信号')
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const outputs: MixedSimulationPayload['outputs'] = scopeNodes.map((scopeNode) => ({
    id: `${scopeNode.id}:in`,
    blockId: scopeNode.id,
    handle: 'in',
    label: scopeNode.data.label ? `Scope ${scopeNode.data.label}` : `Scope ${scopeNode.id}`,
  }))

  return {
    ok: true,
    errors: [],
    payload: {
      kind: 'mixed',
      blocks,
      edges: signalEdges,
      outputs,
      bridges: bridgeBindings,
      circuit: {
        components: circuitComponents,
        nets,
      },
      sim: {
        t_stop: settings.tStop,
        n_samples: settings.nSamples,
      },
    },
  }
}
