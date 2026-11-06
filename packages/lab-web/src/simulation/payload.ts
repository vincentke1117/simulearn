import type { Edge, Node } from '@xyflow/react'

import { circuitComponentLibrary, type CircuitComponentType } from '@/circuit/components'
import {
  SWEEP_MAX_POINTS,
  SWEEP_MIN_POINTS,
  defaultSweepSettings,
  type CircuitNodeData,
  type SimulationPayload,
  type SimulationSettings,
  type SimulationNetPayload,
  type AnalysisMethod,
  type SweepPayload,
  type SweepSettings,
} from '@/types/circuit'

const AC_SOURCE_TYPES = new Set(['vsource_ac', 'isource_ac'])
const CONTROLLED_SOURCE_TYPES = new Set(['vcvs', 'ccvs', 'vccs', 'cccs'])
const PROBE_TYPES = new Set(['voltage_probe', 'current_probe'])

/** 画布上是否存在交流源——ac_phasor / frequency_sweep 的前置条件 */
export function hasAcSource(nodes: Node<CircuitNodeData>[]): boolean {
  return nodes.some((node) => AC_SOURCE_TYPES.has(String(node.type)))
}

export function hasProbe(nodes: Node<CircuitNodeData>[]): boolean {
  return nodes.some((node) => PROBE_TYPES.has(String(node.type)))
}

/**
 * 频率扫描参数校验——与后端硬约束一一对应，提交前就挡住，别让学生吃 422。
 * 后端原话：
 *   "频率扫描点数必须在 2..401 之间" / "频率扫描起始频率必须大于 0"
 *   "频率扫描终止频率必须大于起始频率" / "频率扫描 v1 仅支持对数刻度（scale = \"log\"）"
 */
export function validateSweepSettings(sweep: SweepSettings | undefined): string[] {
  const errors: string[] = []
  if (!sweep) {
    errors.push('频率扫描需要 sweep 参数（起始频率 / 终止频率 / 点数）')
    return errors
  }
  if (!ensureFiniteNumber(sweep.fStartHz) || sweep.fStartHz <= 0) {
    errors.push('频率扫描起始频率必须大于 0')
  }
  if (!ensureFiniteNumber(sweep.fStopHz) || sweep.fStopHz <= sweep.fStartHz) {
    errors.push('频率扫描终止频率必须大于起始频率')
  }
  if (
    !Number.isInteger(sweep.nPoints) ||
    sweep.nPoints < SWEEP_MIN_POINTS ||
    sweep.nPoints > SWEEP_MAX_POINTS
  ) {
    errors.push(`频率扫描点数必须在 ${SWEEP_MIN_POINTS}..${SWEEP_MAX_POINTS} 之间`)
  }
  if (sweep.scale !== 'log') {
    errors.push('频率扫描 v1 仅支持对数刻度（scale = "log"）')
  }
  return errors
}

export function toSweepPayload(sweep: SweepSettings): SweepPayload {
  return {
    f_start_hz: sweep.fStartHz,
    f_stop_hz: sweep.fStopHz,
    n_points: sweep.nPoints,
    scale: sweep.scale,
  }
}

/**
 * ac_phasor 与 frequency_sweep 共用的前置校验（frequency_sweep 沿用 ac_phasor 的求解器约束）：
 * - 至少一个交流源
 * - 不支持受控源
 * - 所有交流源频率必须一致（扫描频率由 sweep 决定，源的 frequency 参数不参与网格）
 */
export function validateAcMethod(nodes: Node<CircuitNodeData>[]): string[] {
  const errors: string[] = []

  if (!hasAcSource(nodes)) {
    errors.push('AC 相量分析需要至少一个交流源（交流电压源 / 交流电流源）')
  }

  const controlled = nodes.filter((node) => CONTROLLED_SOURCE_TYPES.has(String(node.type)))
  if (controlled.length > 0) {
    errors.push(`AC 相量分析暂不支持受控源：${controlled.map((n) => n.data.label ?? n.id).join('、')}`)
  }

  const frequencies = nodes
    .filter((node) => AC_SOURCE_TYPES.has(String(node.type)))
    .map((node) => node.data.parameters?.frequency)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const distinct = Array.from(new Set(frequencies))
  if (distinct.length > 1) {
    errors.push(`交流源频率不一致：AC 相量分析要求所有交流源频率相同（当前：${distinct.join(' / ')} Hz）`)
  }

  return errors
}

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
 * 纯电阻电路可以使用结点电压法等直流分析方法
 */
/**
 * 元件值为 0 时内核算不了的组合（电路方程奇异，只能报内部错误），提交前拦下：
 * - 0 Ω 电阻：任何分析都不行；
 * - 0 F 电容：瞬态里 du/dt = i/C 除以 0；相量 / 扫频里导纳为 0 就是开路，可以算（「拆掉电容」）；
 * - 0 H 电感：瞬态同理，相量 / 扫频里导纳无穷大；直流工作点里电感本来就按短路处理，可以算。
 */
function zeroValueForbidden(type: string, method: AnalysisMethod): boolean {
  if (type === 'resistor') return true
  if (type === 'capacitor') return method === 'transient'
  if (type === 'inductor') return method === 'transient' || method === 'ac_phasor' || method === 'frequency_sweep'
  return false
}

function zeroValueMessage(label: string, parameterLabel: string, type: string): string {
  if (type === 'resistor') return `${label} 的${parameterLabel}不能为 0（要短路就把两端直接连起来，或者用闭合的开关）`
  if (type === 'capacitor') return `${label} 的${parameterLabel}为 0 时不能做瞬态分析（相量分析里 0 F 相当于开路，可以算）`
  return `${label} 的${parameterLabel}为 0 时只能做直流分析（要短路就把两端直接连起来）`
}


export function isResistiveCircuit(nodes: Node<CircuitNodeData>[]): boolean {
  const resistiveComponents = new Set([
    'resistor',
    'vsource_dc',
    'isource_dc',  // 直流电流源也是纯电阻电路元件
    'ground',
    'voltage_probe',
    'current_probe',
    'switch',
    // 四种受控源在直流稳态下均为线性关系，后端 MNA 有完整戳记
    'vccs',
    'vcvs',
    'ccvs',
    'cccs',
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
 * 只按连线算网络（不校验参数）：戴维宁端口下拉、案例预设端口都只需要网络名，
 * 不能因为某个参数暂时无效（比如正在输入 0 Ω）就拿不到
 */
export function buildNets(
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
  methodOverride?: AnalysisMethod,  // 可选指定分析方法，未指定则取 settings.method，再未指定则自动检测
): BuildSimulationPayloadResult {
  const errors: string[] = []
  const diagnostics: string[] = []  // 诊断信息（非错误）

  // 此前这里只看第四个参数，而 CircuitWorkspace 从不传它 —— 工具栏选的分析方法被整个丢掉了。
  const method = methodOverride ?? settings.method

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
  let hasSource = false

  for (const node of nodes) {
    const definition = circuitComponentLibrary[node.type as keyof typeof circuitComponentLibrary]
    if (!definition) {
      errors.push(`未知元件类型：${node.type}`)
      continue
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
      if (parameter.optional && value === undefined) continue
      if (!ensureFiniteNumber(value) || (parameter.min !== undefined && value < parameter.min)) {
        errors.push(`${node.data.label} 的参数 ${parameter.label} 无效`)
      } else if (parameter.key === 'value' && value === 0 && zeroValueForbidden(node.type ?? '', method ?? getDefaultAnalysisMethod(nodes))) {
        errors.push(zeroValueMessage(node.data.label, parameter.label, node.type ?? ''))
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
        // 旋转只是外观：画布上端子和它的 +/− 标签跟着元件一起转，电气含义不变。
        // 原先 180° 时在这里再把 p/n、pos/neg 对调一次，等于转了两次：直流 / 相量（读 connections）
        // 和瞬态（按 nets 接线）给出相反的极性
        connections[handle.id] = netName
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

  // 没有电源但电容 / 电感带着初始值：零输入响应，只有瞬态能算（稳态类分析里初值不起作用，结果全是 0）
  const hasStoredEnergy = nodes.some((n) =>
    (n.type === 'capacitor' && Number(n.data.parameters.v0 ?? 0) !== 0) ||
    (n.type === 'inductor' && Number(n.data.parameters.i0 ?? 0) !== 0))

  // 不接地不算错：内核会自动选参考点并在结果里说明（lab-backend/src/Reference.jl）
  if (!hasSource && method === 'thevenin') {
    // 无源一端口求等效电阻（输入电阻）：开路电压为 0，内核用外加电源法照样求得出 Req
  } else if (!hasSource && !hasStoredEnergy) {
    errors.push('电路必须包含至少一个电源：请添加独立源（直流/交流电压源或电流源）或受控源（VCVS/CCVS/VCCS/CCCS），或者给电容 / 电感设初始值做零输入响应')
  } else if (!hasSource && method && method !== 'transient') {
    errors.push('电路里没有电源，只有电容 / 电感的初始值：这是零输入响应，请选瞬态分析')
  }

  // 智能建议：分析方法
  if (!method && !hasSource) {
    // 如果没有电源，不需要给出分析建议
  } else if (!method) {
    const isResistive = isResistiveCircuit(nodes)
    const hasDynamic = nodes.some(n => n.type === 'capacitor' || n.type === 'inductor')
    const hasAC = nodes.some(n => n.type === 'vsource_ac' || n.type === 'isource_ac')

    if (hasDynamic || hasAC) {
      diagnostics.push('建议：检测到动态/交流元件，将使用瞬态分析')
    } else if (isResistive) {
      diagnostics.push('建议：检测到纯电阻电路，可选择结点电压法、支路电流法或网孔电流法进行分析')
    }
  }

  // 检查分析方法与电路类型的匹配性
  if (method && (method === 'node_voltage' || method === 'branch_current' || method === 'mesh_current')) {
    if (!isResistiveCircuit(nodes)) {
      errors.push(`错误：${method === 'node_voltage' ? '结点电压法' : method === 'branch_current' ? '支路电流法' : '网孔电流法'}仅适用于纯直流线性电路，检测到动态/交流元件，请选择瞬态分析`)
    }
  }

  // 交流类方法的前置校验（与后端 LAB_VALIDATION 对齐，提交前挡住）
  if (method === 'ac_phasor' || method === 'frequency_sweep') {
    errors.push(...validateAcMethod(nodes))
  }

  let sweepPayload: SweepPayload | undefined
  if (method === 'frequency_sweep') {
    if (!hasProbe(nodes)) {
      errors.push('频率扫描需要至少一个探针：请添加电压探针或电流探针，Bode 曲线按探针出图')
    }
    const sweep = settings.sweep ?? defaultSweepSettings
    const sweepErrors = validateSweepSettings(sweep)
    errors.push(...sweepErrors)
    if (sweepErrors.length === 0) {
      sweepPayload = toSweepPayload(sweep)
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
      ...(sweepPayload ? { sweep: sweepPayload } : {}),
    },
  }
}
