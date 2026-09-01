import type { Edge, Node } from '@xyflow/react'

import type {
  AnalysisResultData,
  BranchCurrentResult,
  CircuitNodeData,
  ComparisonResult,
  MeshCurrentResult,
  NodeVoltageResult,
  SimulationSettings,
} from '@/types/circuit'
import { defaultSweepSettings } from '@/types/circuit'
import type { DiagramMode } from '@/types/control'
import type {
  CircuitComponentDefinition,
  CircuitComponentType,
} from '@/circuit/components'
import { supportsVoltageOverlay } from '@/simulation/resultKind'
import { buildProjectSnapshot, loadProjectFromObject, wrapProject } from './project'

export const initialSimulationSettings: SimulationSettings = {
  tStop: 1e-3,
  nSamples: 1000,
  sweep: defaultSweepSettings,
}

export function createNodeData(
  definition: CircuitComponentDefinition<CircuitComponentType>,
): CircuitNodeData {
  const parameters = definition.parameters.reduce<Record<string, number>>((acc, parameter) => {
    if (typeof parameter.defaultValue === 'number') {
      acc[parameter.key] = parameter.defaultValue
    }
    return acc
  }, {})

  return {
    label: definition.prefix,
    type: definition.type,
    parameters,
  }
}

export function getSwitchStateSignature(nodes: Node<CircuitNodeData>[]): string {
  const switches = nodes
    .filter((node) => node.type === 'switch')
    .sort((left, right) => left.id.localeCompare(right.id))
  if (switches.length === 0) return ''
  return switches.map((node) => `${node.id}:${node.data.parameters?.state ?? 0}`).join('|')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasNodeVoltages = (
  data: AnalysisResultData,
): data is NodeVoltageResult | BranchCurrentResult | MeshCurrentResult =>
  isRecord(data) && 'node_voltages' in data

const isComparisonResult = (data: AnalysisResultData): data is ComparisonResult => {
  if (!isRecord(data)) return false
  if ('node_voltages' in data || 'time' in data || 'vth' in data) return false
  return true
}

export function pickNodeVoltages(data: AnalysisResultData): Record<string, number> | null {
  if (!data || !supportsVoltageOverlay(data)) return null
  if (hasNodeVoltages(data)) return data.node_voltages
  if (!isComparisonResult(data)) return null

  const nodeVoltage = data.node_voltage
  const branchCurrent = data.branch_current
  const meshCurrent = data.mesh_current
  if (nodeVoltage && hasNodeVoltages(nodeVoltage)) return nodeVoltage.node_voltages
  if (branchCurrent && hasNodeVoltages(branchCurrent)) return branchCurrent.node_voltages
  if (meshCurrent && hasNodeVoltages(meshCurrent)) return meshCurrent.node_voltages
  return null
}

const hasBranchCurrents = (
  value: unknown,
): value is { branch_currents: Record<string, number> } => {
  if (!isRecord(value) || !('branch_currents' in value)) return false
  return isRecord(value.branch_currents)
}

export function pickBranchCurrents(data: AnalysisResultData): Record<string, number> | null {
  if (!data || !supportsVoltageOverlay(data)) return null
  if (hasBranchCurrents(data)) return data.branch_currents
  if (!isComparisonResult(data)) return null

  const branchCurrent = data.branch_current
  const meshCurrent = data.mesh_current
  if (hasBranchCurrents(branchCurrent)) return branchCurrent.branch_currents
  if (hasBranchCurrents(meshCurrent)) return meshCurrent.branch_currents
  return null
}

function haveEqualCounts(
  previous: Record<string, number> | undefined,
  next: Record<string, number>,
): boolean {
  if (!previous) return Object.keys(next).length === 0
  const previousKeys = Object.keys(previous)
  const nextKeys = Object.keys(next)
  if (previousKeys.length !== nextKeys.length) return false
  return previousKeys.every((key) => previous[key] === next[key])
}

export function applyHandleCounts(
  nodes: Node<CircuitNodeData>[],
  edges: Edge[],
): Node<CircuitNodeData>[] {
  const countsByNode: Record<string, Record<string, number>> = {}
  for (const edge of edges) {
    if (edge.source && edge.sourceHandle) {
      countsByNode[edge.source] ??= {}
      countsByNode[edge.source][edge.sourceHandle] =
        (countsByNode[edge.source][edge.sourceHandle] ?? 0) + 1
    }
    if (edge.target && edge.targetHandle) {
      countsByNode[edge.target] ??= {}
      countsByNode[edge.target][edge.targetHandle] =
        (countsByNode[edge.target][edge.targetHandle] ?? 0) + 1
    }
  }

  let changed = false
  const nextNodes = nodes.map((node) => {
    const nextCounts = countsByNode[node.id] ?? {}
    const previousCounts = node.data.handleCounts as Record<string, number> | undefined
    if (haveEqualCounts(previousCounts, nextCounts)) return node
    changed = true
    return { ...node, data: { ...node.data, handleCounts: nextCounts } }
  })
  return changed ? nextNodes : nodes
}

export function downloadProject(
  nodes: Node<CircuitNodeData>[],
  edges: Edge[],
  diagramMode: DiagramMode,
): void {
  const snapshot = buildProjectSnapshot(nodes, edges)
  const stamp = new Date().toISOString().replace(/[.:]/g, '-')
  const kind = diagramMode === 'control' || diagramMode === 'mixed' ? diagramMode : 'circuit'
  const envelope = wrapProject(kind, `lab-${kind}-${stamp}`, snapshot)
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `simulearn-${kind}-${stamp}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export type ProjectContentResult =
  | { ok: true; nodes: Node<CircuitNodeData>[]; edges: Edge[] }
  | { ok: false; message: string }

export function parseProjectContent(content: string): ProjectContentResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { ok: false, message: '导入失败：JSON 格式错误' }
  }

  const result = loadProjectFromObject(parsed)
  if (!result.ok || !result.nodes || !result.edges) {
    return { ok: false, message: result.errors.join('；') || '导入失败：项目结构无效' }
  }
  return {
    ok: true,
    nodes: result.nodes,
    edges: result.edges.map((edge) => ({ ...edge, type: 'stepBridge' })),
  }
}
