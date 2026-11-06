import type { Edge, Node } from '@xyflow/react'

import { buildSimulationPayload, type BuildSimulationPayloadResult } from '@/simulation/payload'
import { formatReading } from '@/simulation/format'
import type { CircuitNodeData, CircuitProject, SimulationPayload } from '@/types/circuit'
import { initialSimulationSettings } from '@/workspace/circuitWorkspaceHelpers'
import { loadProjectFromObject } from '@/workspace/project'
import { readPath, resolveCheckPath, resolveTheveninPort } from '../checks'
import type { CaseDemoScript, DemoSweepTable, DemoValue, StepsDemo } from './types'

export interface DemoCircuit {
  nodes: Node<CircuitNodeData>[]
  edges: Edge[]
}

/** 演示电路 → 画布节点 / 连线（与案例同一套读法；读不出来就是演示数据写错了） */
export function demoCircuit(project: CircuitProject): DemoCircuit {
  const result = loadProjectFromObject(project)
  if (!result.ok || !result.nodes || !result.edges) throw new Error(`演示电路读不出来：${result.errors.join('；')}`)
  return { nodes: result.nodes, edges: result.edges }
}

/** 第 index 步画布上的电路：本步没写就沿用前面最近一步的（「先圈出、再替换」的第一拍） */
export function stepProject(script: StepsDemo, index: number): CircuitProject {
  for (let i = index; i >= 0; i -= 1) {
    const circuit = script.steps[i]?.circuit
    if (circuit) return circuit
  }
  throw new Error(`演示「${script.title}」第 ${index + 1} 步之前没有电路`)
}

export interface StepRequest {
  build: BuildSimulationPayloadResult
}

function requestFor(project: CircuitProject, method: DemoSweepTable['method'], port?: { positive: string; negative: string }): BuildSimulationPayloadResult {
  const { nodes, edges } = demoCircuit(project)
  const build = buildSimulationPayload(nodes, edges, { ...initialSimulationSettings, method })
  if (build.ok && build.payload && method === 'thevenin' && port) {
    const resolved = resolveTheveninPort({ method, theveninPort: port }, build.payload)
    if (resolved) build.payload.thevenin_port = { positive: resolved.positiveNode, negative: resolved.negativeNode }
    else return { ok: false, errors: [`戴维宁端口 ${port.positive} / ${port.negative} 找不到`] }
  }
  return build
}

/** 第 index 步要交内核算的请求；这一步不算就返回 null（播放器与 e2e 测试共用） */
export function stepRequest(script: StepsDemo, index: number): BuildSimulationPayloadResult | null {
  const step = script.steps[index]
  if (!step?.compute) return null
  const source = step.compute.from ?? index
  return requestFor(stepProject(script, source), step.compute.method, step.compute.theveninPort)
}

/** 对照表每一行的请求：把某个元件参数换成表里的值 */
export function tableRequests(script: StepsDemo, index: number): BuildSimulationPayloadResult[] {
  const table = script.steps[index]?.table
  if (!table) return []
  const base = stepProject(script, table.from ?? index)
  return table.values.map((value) => {
    const project: CircuitProject = JSON.parse(JSON.stringify(base))
    const node = project.nodes.find((item) => item.id === table.param.id)
    if (!node) return { ok: false, errors: [`对照表参数元件 ${table.param.id} 不在电路里`] }
    node.data.parameters[table.param.key] = value
    return requestFor(project, table.method)
  })
}

export interface ValueOutcome {
  value: DemoValue
  actual?: number
  ok: boolean
  reason?: string
}

/** 按路径取读数并做 rms / transform 加工；expect 存在时一并判断是否在容差内 */
export function evaluateValue(value: { path: string; rms?: boolean; transform?: DemoValue['transform']; expect?: number; tol?: number }, payload: Pick<SimulationPayload, 'components'>, data: unknown): { actual?: number; ok: boolean; reason?: string } {
  const path = resolveCheckPath(value.path, payload)
  if (!path) return { ok: false, reason: `路径里的探针 / 端子找不到：${value.path}` }
  const raw = readPath(data, path)
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, reason: `结果里没有 ${path}` }
  let actual = value.rms ? raw / Math.SQRT2 : raw
  if (value.transform === 'reciprocal') actual = 1 / actual
  if (value.transform === 'negate') actual = -actual
  const ok = value.expect === undefined || Math.abs(actual - value.expect) <= (value.tol ?? 0)
  return { actual, ok }
}

export function evaluateValues(values: DemoValue[], payload: Pick<SimulationPayload, 'components'>, data: unknown): ValueOutcome[] {
  return values.map((value) => ({ value, ...evaluateValue(value, payload, data) }))
}

export function formatValue(value: Pick<DemoValue, 'unit' | 'digits' | 'rms'>, actual: number): string {
  return `${formatReading(actual, value.unit, value.digits ?? 4)}${value.rms ? '（有效值）' : ''}`
}

/** 讲解文字里的 {key} 换成读数；还没算出来的显示「…」 */
export function fillText(text: string, outcomes: ValueOutcome[] | undefined): string {
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key: string) => {
    const outcome = outcomes?.find((item) => item.value.key === key)
    if (!outcome) return outcomes ? whole : '…'
    return outcome.actual === undefined ? '—' : formatValue(outcome.value, outcome.actual)
  })
}

export function isStepsDemo(script: CaseDemoScript): script is StepsDemo {
  return script.kind === 'steps'
}
