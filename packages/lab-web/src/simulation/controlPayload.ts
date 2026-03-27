import type { Edge, Node } from '@xyflow/react'

import { circuitComponentLibrary } from '@/circuit/components'
import type { CircuitNodeData, SimulationSettings } from '@/types/circuit'
import {
  CONTROL_DYNAMIC_COMPONENT_TYPES,
  type ControlComponentType,
  type ControlSimulationPayload,
} from '@/types/control'
import { detectDiagramMode, isControlComponentType } from '@/simulation/diagramMode'

export interface BuildControlSimulationPayloadResult {
  ok: boolean
  payload?: ControlSimulationPayload
  errors: string[]
}

interface HandleSchema {
  inputs: string[]
  outputs: string[]
}

const handleSchema: Record<ControlComponentType, HandleSchema> = {
  control_step: { inputs: [], outputs: ['out'] },
  control_constant: { inputs: [], outputs: ['out'] },
  control_sum: { inputs: ['in1', 'in2'], outputs: ['out'] },
  control_gain: { inputs: ['in'], outputs: ['out'] },
  control_integrator: { inputs: ['in'], outputs: ['out'] },
  control_plant_1st: { inputs: ['in'], outputs: ['out'] },
  control_pid: { inputs: ['in'], outputs: ['out'] },
  control_scope: { inputs: ['in'], outputs: [] },
}

function ensureFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
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

export function buildControlSimulationPayload(
  nodes: Node<CircuitNodeData>[],
  edges: Edge[],
  settings: SimulationSettings,
): BuildControlSimulationPayloadResult {
  const errors: string[] = []

  if (!(settings.tStop > 0)) {
    errors.push('仿真时长必须大于 0')
  }
  if (!Number.isInteger(settings.nSamples) || settings.nSamples < 2) {
    errors.push('采样点数至少为 2 且必须为整数')
  }

  if (nodes.length === 0) {
    errors.push('请先在画布中放置控制元件')
    return { ok: false, errors }
  }

  const mode = detectDiagramMode(nodes)
  if (mode === 'mixed') {
    errors.push('混合图暂不支持：请在本阶段使用纯控制图或纯电路图')
    return { ok: false, errors }
  }
  if (mode !== 'control') {
    errors.push('当前画布不是控制系统图')
    return { ok: false, errors }
  }

  const nodeMap = new Map<string, Node<CircuitNodeData>>()
  const blocks: ControlSimulationPayload['blocks'] = []
  const scopeNodes: Node<CircuitNodeData>[] = []

  for (const node of nodes) {
    nodeMap.set(node.id, node)
    const type = String(node.type ?? '')
    if (!isControlComponentType(type)) {
      errors.push(`元件 ${node.id} 不是控制元件`)
      continue
    }

    const definition = circuitComponentLibrary[type]
    if (!definition) {
      errors.push(`元件 ${node.id} 的类型 ${type} 未定义`)
      continue
    }

    const parameters: Record<string, number> = {}
    for (const parameter of definition.parameters) {
      const raw = node.data.parameters[parameter.key]
      if (!ensureFiniteNumber(raw)) {
        errors.push(`${node.id} 的参数 ${parameter.label} 必须是有限数值`)
        continue
      }
      if (parameter.min !== undefined && raw < parameter.min) {
        errors.push(`${node.id} 的参数 ${parameter.label} 不能小于 ${parameter.min}`)
        continue
      }
      parameters[parameter.key] = raw
    }

    blocks.push({
      id: node.id,
      type,
      parameters,
    })

    if (type === 'control_scope') {
      scopeNodes.push(node)
    }
  }

  const incomingByTarget = new Map<string, Edge[]>()
  const adjacency = new Map<string, Set<string>>()
  const payloadEdges: ControlSimulationPayload['edges'] = []

  for (const node of nodes) {
    adjacency.set(node.id, new Set<string>())
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
    if (!isControlComponentType(sourceType) || !isControlComponentType(targetType)) {
      errors.push(`连线 ${edge.id} 连接了非控制元件`)
      continue
    }

    const sourceSchema = handleSchema[sourceType]
    const targetSchema = handleSchema[targetType]
    if (!sourceSchema.outputs.includes(edge.sourceHandle)) {
      errors.push(`连线 ${edge.id} 的 sourceHandle ${edge.sourceHandle} 不是 ${sourceNode.id} 的输出端口`)
    }
    if (!targetSchema.inputs.includes(edge.targetHandle)) {
      errors.push(`连线 ${edge.id} 的 targetHandle ${edge.targetHandle} 不是 ${targetNode.id} 的输入端口`)
    }

    const key = incomingKey(edge.target, edge.targetHandle)
    const incoming = incomingByTarget.get(key) ?? []
    incoming.push(edge)
    incomingByTarget.set(key, incoming)
    if (incoming.length > 1) {
      errors.push(`${edge.target} 的端口 ${edge.targetHandle} 不能连接多条输入线`)
    }

    adjacency.get(edge.source)?.add(edge.target)
    payloadEdges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })
  }

  for (const block of blocks) {
    const schema = handleSchema[block.type]
    for (const input of schema.inputs) {
      const key = incomingKey(block.id, input)
      if (!incomingByTarget.has(key)) {
        errors.push(`${block.id} 的端口 ${input} 未连接`)
      }
    }
  }

  if (scopeNodes.length === 0) {
    errors.push('控制系统至少包含一个示波器 (control_scope)')
  }

  const controlNodeIds = blocks.map((block) => block.id)
  const componentTypeById = new Map(blocks.map((block) => [block.id, block.type]))
  const sccs = stronglyConnectedComponents(controlNodeIds, adjacency)
  for (const component of sccs) {
    const isSelfCycle = component.length === 1 && (adjacency.get(component[0])?.has(component[0]) ?? false)
    const isCycle = component.length > 1 || isSelfCycle
    if (!isCycle) continue

    const hasDynamicBlock = component.some((nodeId) => {
      const type = componentTypeById.get(nodeId)
      return Boolean(type && CONTROL_DYNAMIC_COMPONENT_TYPES.has(type))
    })
    if (!hasDynamicBlock) {
      errors.push(`检测到纯代数环：${component.join(' -> ')}。请在反馈环中加入动态环节`)
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const outputs: ControlSimulationPayload['outputs'] = scopeNodes.map((scopeNode) => ({
    id: `${scopeNode.id}:in`,
    blockId: scopeNode.id,
    handle: 'in',
    label: scopeNode.data.label ? `Scope ${scopeNode.data.label}` : `Scope ${scopeNode.id}`,
  }))

  return {
    ok: true,
    errors: [],
    payload: {
      kind: 'control',
      blocks,
      edges: payloadEdges,
      outputs,
      sim: {
        t_stop: settings.tStop,
        n_samples: settings.nSamples,
      },
    },
  }
}
