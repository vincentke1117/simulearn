import type { Node } from '@xyflow/react'

import type { CircuitNodeData, SimulationPayload } from '@/types/circuit'
import type { KvlBranch, KvlLoop, KvlLoopElement } from './types'

/**
 * KVL 演示的计算（纯函数，播放器和测试共用）。
 *
 * 电压参考方向：电阻、电容、电感取 p 端为 +（与支路电流 p→n 关联）；电源取 pos 端为 +。
 * 绕行时从 + 端进、− 端出，参考方向与绕行方向一致，记 +u；反之记 −u（教材 §1-8 的规则）。
 * 项前的符号只由参考方向决定，和读数本身的正负无关——这正是学生最容易混的「两套正负号」。
 */

export type KvlDirection = 'cw' | 'ccw'

const OTHER_TERMINAL: Record<string, string> = { p: 'n', n: 'p', pos: 'neg', neg: 'pos' }
const PLUS_TERMINAL = new Set(['p', 'pos'])

export function exitOf(element: KvlLoopElement): string {
  if (element.exit) return element.exit
  const other = OTHER_TERMINAL[element.enter]
  if (!other) throw new Error(`元件 ${element.id} 从 ${element.enter} 进入，必须写明从哪个端子出去`)
  return other
}

/** 逆时针：元件倒序，进出端子对调 */
export function orientLoop(loop: KvlLoop, direction: KvlDirection): Array<{ id: string; enter: string; exit: string }> {
  const forward = loop.elements.map((element) => ({ id: element.id, enter: element.enter, exit: exitOf(element) }))
  if (direction === 'cw') return forward
  return forward.reverse().map((element) => ({ id: element.id, enter: element.exit, exit: element.enter }))
}

function netOf(payload: Pick<SimulationPayload, 'components'>, id: string, handle: string): string | undefined {
  return payload.components.find((component) => component.id === id)?.connections[handle]
}

function potential(nodeVoltages: Record<string, number>, net: string | undefined): number {
  if (!net) return Number.NaN
  return net === 'gnd' ? (nodeVoltages.gnd ?? 0) : (nodeVoltages[net] ?? Number.NaN)
}

/** 元件电压 u（参考方向：+ 端减 − 端） */
export function elementVoltage(payload: Pick<SimulationPayload, 'components'>, nodeVoltages: Record<string, number>, id: string): number {
  const component = payload.components.find((item) => item.id === id)
  if (!component) return Number.NaN
  const [plus, minus] = 'pos' in component.connections ? ['pos', 'neg'] : ['p', 'n']
  return potential(nodeVoltages, component.connections[plus]) - potential(nodeVoltages, component.connections[minus])
}

export interface KvlTerm {
  id: string
  label: string
  enter: string
  exit: string
  /** +1：从 + 端进（参考方向与绕行一致）；−1：从 − 端进 */
  sign: 1 | -1
  /** 元件电压读数（参考方向下，可正可负） */
  u: number
  /** 这一项对和的贡献 sign·u */
  contribution: number
  /** 走到这个元件之前 / 之后的电位（起点记 0） */
  before: number
  after: number
}

export function loopTerms(
  loop: KvlLoop,
  direction: KvlDirection,
  payload: Pick<SimulationPayload, 'components'>,
  nodeVoltages: Record<string, number>,
  labels: Record<string, string>,
): KvlTerm[] {
  let level = 0
  return orientLoop(loop, direction).map((element) => {
    const sign: 1 | -1 = PLUS_TERMINAL.has(element.enter) ? 1 : -1
    const u = elementVoltage(payload, nodeVoltages, element.id)
    const contribution = sign * u
    const before = level
    // 绕行经过一个电压降 u（从 + 到 −），电位降低 u
    level -= contribution
    return { ...element, label: labels[element.id] ?? element.id, sign, u, contribution, before, after: level }
  })
}

/** 回路首尾、相邻元件是否真的接在一起（数据自洽检查，测试用） */
export function loopIsClosed(loop: KvlLoop, payload: Pick<SimulationPayload, 'components'>): string | null {
  const elements = orientLoop(loop, 'cw')
  for (let i = 0; i < elements.length; i += 1) {
    const current = elements[i]
    const next = elements[(i + 1) % elements.length]
    const a = netOf(payload, current.id, current.exit)
    const b = netOf(payload, next.id, next.enter)
    if (!a || !b) return `${current.id}.${current.exit} 或 ${next.id}.${next.enter} 没接`
    if (a !== b) return `${current.id}.${current.exit} 与 ${next.id}.${next.enter} 不在同一个结点`
  }
  return null
}

const SUBSCRIPT_FREE = (label: string) => `u_${label}`

/** 一项的三种写法：符号项、欧姆定律 / 电源值、代入值（负值带括号） */
export function termTexts(
  term: KvlTerm,
  nodes: Node<CircuitNodeData>[],
  branches: KvlBranch[],
  unit = 'V',
): { symbol: string; law: string; substituted: string } {
  const name = SUBSCRIPT_FREE(term.label)
  const symbol = `${term.sign > 0 ? '+' : '−'}${name}`
  const node = nodes.find((item) => item.id === term.id)
  let law = ''
  if (node?.type === 'resistor') {
    const branch = branches.find((item) => item.ref === term.id)
    if (branch) law = `${name} = ${node.data.parameters.value}·${branch.name}`
  } else if (node?.type === 'vsource_dc') {
    law = `${name} = ${node.data.parameters.dc} ${unit}`
  }
  const shown = formatNumber(term.u)
  const substituted = `${term.sign > 0 ? '+' : '−'}${term.u < 0 ? `(${shown})` : shown}`
  return { symbol, law, substituted }
}

/** 方程里的数：去掉浮点尾巴（119.99999999 → 120），保留到 4 位有效数字 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 1e-9) return '0'
  const rounded = Number(value.toPrecision(4))
  return String(rounded).replace('-', '−')
}

/** 支路电流读数：参考方向沿 ref 元件 p→n */
export function branchCurrent(branch: KvlBranch, branchCurrents: Record<string, number>): number {
  return branchCurrents[branch.ref] ?? Number.NaN
}
