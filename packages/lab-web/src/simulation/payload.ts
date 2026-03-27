import type { Edge, Node } from '@xyflow/react'

import { circuitComponentLibrary, type CircuitComponentType } from '@/circuit/components'
import type {
  CircuitNodeData,
  SimulationPayload,
  SimulationSettings,
  SimulationNetPayload,
  AnalysisMethod,
} from '@/types/circuit'

export interface BuildSimulationPayloadResult {
  ok: boolean
  payload?: SimulationPayload
  errors: string[]
  diagnostics?: string[]
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

function handleKey(nodeId: string, handleId: string) {
  return `${nodeId}:${handleId}` as const
}

function ensureFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 检测是否为纯电阻电路（只包含电阻、直流电压源、地、探针）
 * 纯电阻电路可以使用节点电压法等直流分析方法
 */
export function isResistiveCircuit(nodes: Node<CircuitNodeData>[]): boolean {
  const resistiveComponents = new Set([
    'resistor',
    'vsource_dc',
    'isource_dc',  // 直流电流源也是纯电阻电路元件
    'ground',
    'voltage_probe',
    'current_probe',
    'switch',
    // 受控电流源（VCCS）在直流稳态下属于线性关系，可用节点电压法
    'vccs',
    'vcvs',
  ])
  
  return nodes.every(node => resistiveComponents.has(node.type as string))
}

/**
 * 根据电路类型推荐默认分析方法
 */
export function getDefaultAnalysisMethod(nodes: Node<CircuitNodeData>[]): AnalysisMethod {
  return isResistiveCircuit(nodes) ? 'node_voltage' : 'transient'
}

/**
 * 根据旋转角度映射实际handle到逻辑handle
 * 对于有极性的双端元件，180度旋转时p/n互换
 * @param handleId 原始handle ID（用户连接时使用的ID）
 * @param componentType 元件类型
 * @param rotation 旋转角度（0/90/180/270）
 * @returns 映射后的逻辑handle ID（用于后端电路分析）
 */
function mapHandleWithRotation(handleId: string, componentType: string, rotation: number): string {
  const normalizedRotation = ((rotation ?? 0) % 360 + 360) % 360
  
  // 对于有极性的双端元件（电阻、电容、电感、电压源、电流源、电流探针），180度旋转时端口互换
  const needsSwap = [
    'resistor',
    'capacitor', 
    'inductor',
    'vsource_dc',
    'vsource_ac',
    'isource_dc',
    'isource_ac',
    'current_probe',
    'switch',
    // 受控源为四端口器件，180° 时输出与控制端对调
    'vcvs',
    'ccvs',
    'vccs',
    'cccs',
  ].includes(componentType)
  
  if (!needsSwap) {
    // 单端元件（地、电压探针）或其他元件不需要映射
    return handleId
  }
  
  // 180度旋转时交换端口
  if (normalizedRotation === 180) {
    // p <-> n 互换
    if (handleId === 'p') return 'n'
    if (handleId === 'n') return 'p'
    // pos <-> neg 互换（电压源）
    if (handleId === 'pos') return 'neg'
    if (handleId === 'neg') return 'pos'
    // 受控源的控制端：ctrl_p <-> ctrl_n 互换
    if (handleId === 'ctrl_p') return 'ctrl_n'
    if (handleId === 'ctrl_n') return 'ctrl_p'
  }
  
  return handleId
}

function buildNets(
  nodes: Node<CircuitNodeData>[],
  edges: Edge[],
): {
  nets: SimulationNetPayload[]
  handleNetMap: Map<string, string>
  errors: string[]
} {
  const errors: string[] = []
  const disjointSet = new DisjointSet<string>()
  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) {
      errors.push(`连线 ${edge.id} 缺少端子信息`)
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
  let gndAssigned = false  // 仅允许一个网络命名为 gnd（防止重复命名）

  const groups = disjointSet.groups()
  for (const [, groupHandles] of groups) {
    const members: [string, string][] = []
    let hasGround = false

    for (const handleKeyEntry of groupHandles) {
      const [nodeId, handleId] = handleKeyEntry.split(':')
      const node = nodeMap.get(nodeId)
      if (!node) {
        errors.push(`连线引用了不存在的元件 ${nodeId}`)
        continue
      }
      const definition = circuitComponentLibrary[node.type as keyof typeof circuitComponentLibrary]
      if (!definition) {
        errors.push(`连线引用了未知元件类型 ${node.type}`)
        continue
      }
      const handleExists = definition.handles.some((handle) => handle.id === handleId)
      if (!handleExists) {
        const label = node.data.label ?? node.id
        errors.push(`${label} 不存在端子 ${handleId}`)
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

    // 若该连通分量包含地线，则命名为 gnd；若已有 gnd，则提示错误并使用普通命名
    let name: string
    if (hasGround && !gndAssigned) {
      name = 'gnd'
      gndAssigned = true
    } else if (hasGround && gndAssigned) {
      // 已存在一个地网，再出现新的地线连通分量，属于建模错误
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

export function buildSimulationPayload(
  nodes: Node<CircuitNodeData>[],
  edges: Edge[],
  settings: SimulationSettings,
  method?: AnalysisMethod,  // 可选指定分析方法，未指定则自动检测
): BuildSimulationPayloadResult {
  const errors: string[] = []
  const diagnostics: string[] = []  // 诊断信息（非错误）

  if (!(settings.tStop > 0)) {
    errors.push('仿真时长必须大于 0')
  }
  if (!Number.isInteger(settings.nSamples) || settings.nSamples < 2) {
    errors.push('采样点数至少为 2 且必须为整数')
  }

  if (nodes.length === 0) {
    errors.push('请先在画布中放置元件')
    return { ok: false, errors, diagnostics }
  }

  // 智能诊断：检查断路元件
  const connectedNodes = new Set<string>()
  edges.forEach(e => {
    connectedNodes.add(e.source)
    connectedNodes.add(e.target)
  })
  
  const disconnectedComponents: string[] = []
  for (const node of nodes) {
    if (node.type === 'ground') continue  // 地线可以不连接
    if (!connectedNodes.has(node.id)) {
      const def = circuitComponentLibrary[node.type as keyof typeof circuitComponentLibrary]
      disconnectedComponents.push(`${node.data.label} (${def?.label ?? node.type})`)
    }
  }
  
  if (disconnectedComponents.length > 0) {
    errors.push(`检测到断路元件：${disconnectedComponents.join(', ')} - 请连接它们的所有端子`)
  }

  const { nets, handleNetMap, errors: netErrors } = buildNets(nodes, edges)
  errors.push(...netErrors)

  const components: SimulationPayload['components'] = []
  let hasGround = false
  let hasSource = false

  for (const node of nodes) {
    const definition = circuitComponentLibrary[node.type as keyof typeof circuitComponentLibrary]
    if (!definition) {
      errors.push(`未知元件类型：${node.type}`)
      continue
    }

    if (node.type === 'ground') {
      hasGround = true
    }

    // 任何“源”均视为电源：独立电压/电流源 + 受控源
    if (
      node.type === 'vsource_dc' ||
      node.type === 'vsource_ac' ||
      node.type === 'isource_dc' ||
      node.type === 'isource_ac' ||
      node.type === 'vcvs' ||
      node.type === 'ccvs' ||
      node.type === 'vccs' ||
      node.type === 'cccs'
    ) {
      hasSource = true
    }

    const parameters: Record<string, number> = {}
    for (const parameter of definition.parameters) {
      const value = node.data.parameters[parameter.key]
      if (!ensureFiniteNumber(value) || (parameter.min !== undefined && value < parameter.min)) {
        errors.push(`${node.data.label} 的参数 ${parameter.label} 无效`)
      } else {
        parameters[parameter.key] = value
      }
    }

    const connections: Record<string, string> = {}
    for (const handle of definition.handles) {
      const key = handleKey(node.id, handle.id)
      const netName = handleNetMap.get(key)
      if (!netName) {
        errors.push(`${node.data.label} 的端子 ${handle.id} 未连接`)
      } else {
        // 根据旋转角度映射handle ID：180度旋转时p/n互换
        const componentType = node.type ?? ''
        const logicalHandleId = mapHandleWithRotation(handle.id, componentType, node.data.rotation ?? 0)
        connections[logicalHandleId] = netName
      }
    }

    if (node.type === 'switch') {
      // 将开关转换为电阻模型：闭合=1μΩ，断开=1GΩ
      const state = parameters['state'] ?? 0
      const resistance = state === 1 ? 1e-6 : 1e9
      components.push({
        id: node.id,
        type: 'resistor',
        parameters: { value: resistance },
        connections,
      })
    } else {
      components.push({
        id: node.id,
        type: node.type as CircuitComponentType,
        parameters,
        connections,
      })
    }
  }

  if (!hasGround) {
    errors.push('电路缺少地线：请从左侧元件面板添加地线 (Ground) 元件')
  }

  if (!hasSource) {
    errors.push('电路必须包含至少一个电源：请添加独立源（直流/交流电压源或电流源）或受控源（VCVS/CCVS/VCCS/CCCS）')
  }

  // 智能建议：分析方法
  if (!method && !hasSource) {
    // 如果没有电源，不需要给出分析建议
  } else if (!method) {
    const isResistive = isResistiveCircuit(nodes)
    const hasDynamic = nodes.some(n => n.type === 'capacitor' || n.type === 'inductor')
    const hasAC = nodes.some(n => n.type === 'vsource_ac' || n.type === 'isource_ac')
    const hasUnsupportedControlled = nodes.some(n => n.type === 'ccvs' || n.type === 'cccs')

    if (hasDynamic || hasAC || hasUnsupportedControlled) {
      diagnostics.push('建议：检测到动态/交流/受控源，将使用瞬态分析')
    } else if (isResistive) {
      diagnostics.push('建议：检测到纯电阻电路，可选择节点电压法、支路电流法或网孔电流法进行分析')
    }
  }

  // 检查分析方法与电路类型的匹配性
  if (method && (method === 'node_voltage' || method === 'branch_current' || method === 'mesh_current')) {
    const isResistive = isResistiveCircuit(nodes)
    const hasUnsupportedControlled = nodes.some(n => n.type === 'ccvs' || n.type === 'cccs')
    if (!isResistive || hasUnsupportedControlled) {
      errors.push(`错误：${method === 'node_voltage' ? '节点电压法' : method === 'branch_current' ? '支路电流法' : '网孔电流法'}仅适用于纯直流线性电路（支持VCCS），检测到 VCVS/CCVS/CCCS 或动态/交流元件，请选择瞬态分析`)
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, diagnostics }
  }

  // 自动检测分析方法（如果未指定）
  const analysisMethod = method ?? getDefaultAnalysisMethod(nodes)

  return {
    ok: true,
    errors: [],
    diagnostics,
    payload: {
      components,
      nets,
      sim: {
        t_stop: settings.tStop,
        n_samples: settings.nSamples,
      },
      method: analysisMethod,
    },
  }
}
