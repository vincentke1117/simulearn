import type { Edge, Node } from '@xyflow/react'

import { circuitComponentLibrary, type CircuitComponentType } from '@/circuit/components'
import type {
  CircuitNodeData,
  MixedSimulationPayload,
  SimulationSettings,
} from '@/types/circuit'
import {
  detectDiagramMode,
  isBridgeComponentType,
  isControlComponentType,
  isElectricalComponentType,
} from '@/simulation/diagramMode'
import { analyzeMixedTopology } from '@/simulation/mixedPayloadTopology'

export interface BuildMixedSimulationPayloadResult {
  ok: boolean
  payload?: MixedSimulationPayload
  errors: string[]
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

function ensureFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function buildMixedSimulationPayload(
  nodes: Node<CircuitNodeData>[],
  edges: Edge[],
  settings: SimulationSettings,
): BuildMixedSimulationPayloadResult {
  const errors: string[] = []

  if (!(settings.tStop > 0)) errors.push('仿真时长必须大于 0')
  if (!Number.isInteger(settings.nSamples) || settings.nSamples < 2) {
    errors.push('采样点数至少为 2 且必须为整数')
  }
  if (nodes.length === 0) {
    errors.push('请先在画布中放置元件')
    return { ok: false, errors }
  }
  if (detectDiagramMode(nodes) !== 'mixed') {
    errors.push('当前画布不是混合图（电路+控制）')
    return { ok: false, errors }
  }

  const topology = analyzeMixedTopology(nodes, edges)
  errors.push(...topology.errors)

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
        const netName = topology.netFor(node.id, handle.id)
        if (!netName) {
          errors.push(`${node.id} 的端子 ${handle.id} 未连接`)
          continue
        }
        connections[handle.id] = netName
      }

      if (node.type === 'ground') hasGround = true
      if (
        node.type === 'vsource_dc'
        || node.type === 'isource_dc'
        || node.type === 'vcvs'
        || node.type === 'ccvs'
        || node.type === 'vccs'
        || node.type === 'cccs'
      ) {
        hasElectricalSource = true
      }
      if (node.type === 'voltage_probe' || node.type === 'current_probe') hasElectricalProbe = true

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

      blocks.push({ id: node.id, type, parameters })
      if (type === 'control_scope') scopeNodes.push(node)
      if (isControlComponentType(type)) hasControl = true
      if (isBridgeComponentType(type)) {
        hasBridge = true
        if (type === 'voltage_sensor' || type === 'current_sensor') {
          const pNet = topology.netFor(node.id, 'p')
          const nNet = topology.netFor(node.id, 'n')
          if (!pNet || !nNet) {
            errors.push(`${node.id} 的电气端口 p/n 必须连接到电路网络`)
          } else {
            bridgeBindings.push({ blockId: node.id, positiveNet: pNet, negativeNet: nNet })
          }
        } else {
          const posNet = topology.netFor(node.id, 'pos')
          const negNet = topology.netFor(node.id, 'neg')
          if (!posNet || !negNet) {
            errors.push(`${node.id} 的电气端口 pos/neg 必须连接到电路网络`)
          } else {
            bridgeBindings.push({ blockId: node.id, positiveNet: posNet, negativeNet: negNet })
          }
          hasElectricalSource = true
        }
      }
      continue
    }

    errors.push(`元件 ${node.id} 类型不受支持`)
  }

  for (const { blockId, input } of topology.missingSignalInputs) {
    errors.push(`${blockId} 的信号端口 ${input} 未连接`)
  }
  for (const component of topology.algebraicLoops) {
    errors.push(`检测到纯代数环：${component.join(' -> ')}。请在反馈环中加入动态环节`)
  }

  if (!hasBridge) errors.push('混合仿真至少需要一个桥接元件（传感器或受控源）')
  if (!hasControl) errors.push('混合仿真需要至少一个控制块（如 Step/Gain/PID）')
  if (!hasGround) errors.push('混合仿真电路侧缺少地线 (ground)')
  if (!hasElectricalSource) errors.push('混合仿真电路侧缺少激励源：请添加独立源或受控源')
  if (scopeNodes.length === 0 && !hasElectricalProbe) {
    errors.push('请至少添加一个 control_scope 或电气探针作为输出信号')
  }
  if (errors.length > 0) return { ok: false, errors }

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
      edges: topology.signalEdges,
      outputs,
      bridges: bridgeBindings,
      circuit: {
        components: circuitComponents,
        nets: topology.nets,
      },
      sim: {
        t_stop: settings.tStop,
        n_samples: settings.nSamples,
      },
    },
  }
}
