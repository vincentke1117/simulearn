import type { Edge, Node } from '@xyflow/react'

import { circuitSignature, projectFingerprint } from '@/embed/protocol'
import { buildSimulationPayload, type BuildSimulationPayloadResult } from '@/simulation/payload'
import type { CircuitNodeData } from '@/types/circuit'
import { loadProjectFromObject } from '@/workspace/project'
import { presetSettings, resolveTheveninPort } from './checks'
import type { CaseLibrary, TeachingCase } from './types'

// 案例一个 JSON 一份，放在 data/ 下；新增案例只要加文件，这里按章节、例题号排好
const modules = import.meta.glob<{ default: unknown }>('./data/*.json', { eager: true })

function exampleOrder(source: string): number[] {
  return (source.match(/\d+/g) ?? []).map(Number)
}

function byChapter(a: TeachingCase, b: TeachingCase): number {
  const [x, y] = [exampleOrder(a.source), exampleOrder(b.source)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return a.id.localeCompare(b.id)
}

export const QIU_CASES: TeachingCase[] = Object.values(modules)
  .map((module) => module.default as TeachingCase)
  .sort(byChapter)

/** 课程包里写 {"library": "<id>"} 打开案例库；目前只有一套，按邱关源《电路》的章节编排 */
export const CASE_LIBRARIES: Record<string, CaseLibrary> = {
  'qiu-circuits': {
    id: 'qiu-circuits',
    title: '电路案例库',
    subtitle: '按邱关源、罗先觉《电路》的章节编排，电路与参数取自书中例题',
    cases: QIU_CASES,
  },
}

export function findLibrary(id: string): CaseLibrary | undefined {
  return Object.prototype.hasOwnProperty.call(CASE_LIBRARIES, id) ? CASE_LIBRARIES[id] : undefined
}

export interface CaseCircuit {
  nodes: Node<CircuitNodeData>[]
  edges: Edge[]
}

/** 案例 → 画布电路；与嵌入页「工程文件」一样走 loadProjectFromObject，连线统一用 stepBridge */
export function caseCircuit(item: TeachingCase): CaseCircuit {
  const result = loadProjectFromObject(item.circuit)
  if (!result.ok || !result.nodes || !result.edges) {
    throw new Error(`案例 ${item.id} 的电路读不出来：${result.errors.join('；')}`)
  }
  return { nodes: result.nodes, edges: result.edges.map((edge) => ({ ...edge, type: 'stepBridge' })) }
}

/** 案例草稿的指纹：案例 id + 电气内容，案例改版（元件、参数、连线变了）后旧草稿不再恢复 */
export function caseFingerprint(item: TeachingCase, initial: CaseCircuit = caseCircuit(item)): string {
  return projectFingerprint({ case: item.id, circuit: circuitSignature(initial.nodes, initial.edges) })
}

/** 按案例预设构造发给内核的请求（测试与页面共用），戴维宁端口也在这里换成网络名 */
export function casePayload(item: TeachingCase, circuit: CaseCircuit = caseCircuit(item)): BuildSimulationPayloadResult {
  const build = buildSimulationPayload(circuit.nodes, circuit.edges, presetSettings(item.preset))
  if (build.ok && build.payload && item.preset.method === 'thevenin') {
    const port = resolveTheveninPort(item.preset, build.payload)
    if (port) build.payload.thevenin_port = { positive: port.positiveNode, negative: port.negativeNode }
  }
  return build
}
