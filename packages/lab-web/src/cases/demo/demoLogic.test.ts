import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import type { CircuitNodeData } from '@/types/circuit'
import { evaluateValue, fillText } from './demoPayload'
import { terminalPoint } from './geometry'
import { exitOf, formatNumber, loopIsClosed, loopTerms, orientLoop, termTexts } from './kvl'
import { edgeKey, interpolate, mergeEdges, mergeNodes, unionBounds } from './transition'
import type { KvlLoop } from './types'

function node(id: string, type: string, x = 0, y = 0, parameters: Record<string, number> = {}): Node<CircuitNodeData> {
  return { id, type, position: { x, y }, data: { label: id, type: type as CircuitNodeData['type'], parameters } }
}

describe('换步过渡', () => {
  it('连线身份只看两端（与方向、编号无关）', () => {
    expect(edgeKey({ source: 'R1', sourceHandle: 'n', target: 'R2', targetHandle: 'p' }))
      .toBe(edgeKey({ source: 'R2', sourceHandle: 'p', target: 'R1', targetHandle: 'n' }))
  })

  it('保留的元件沿用旧节点对象（measured 不丢），先放在起点并记下位移；新的标入场，离开的标出场', () => {
    const old = { ...node('R1', 'resistor', 0, 0), measured: { width: 160, height: 120 } }
    const merged = mergeNodes([old, node('R2', 'resistor', 300, 0)], [node('R1', 'resistor', 100, 50), node('R3', 'resistor', 0, 200)], (_, entering) => (entering ? 'demo-enter' : ''))
    const r1 = merged.nodes.find((item) => item.id === 'R1')!
    expect(r1.measured).toEqual({ width: 160, height: 120 })
    expect(r1.position).toEqual({ x: 0, y: 0 })
    expect(merged.moves).toEqual([{ id: 'R1', from: { x: 0, y: 0 }, to: { x: 100, y: 50 } }])
    expect(merged.entering).toEqual(['R3'])
    expect(merged.leaving).toEqual(['R2'])
    expect(merged.nodes.find((item) => item.id === 'R2')?.className).toContain('demo-leave')
  })

  it('同 id 换了类型按新元件处理（电压源换成电流源要淡出淡入，不能硬挪）', () => {
    const merged = mergeNodes([node('S', 'vsource_dc')], [node('S', 'isource_dc')], () => '')
    expect(merged.entering).toEqual(['S'])
    expect(merged.moves).toEqual([])
  })

  it('连线：保留的不重建，新的淡入，消失的留着淡出', () => {
    const a = { id: 'x', source: 'R1', target: 'R2', sourceHandle: 'n', targetHandle: 'p' }
    const b = { id: 'y', source: 'R2', target: 'R3', sourceHandle: 'n', targetHandle: 'p' }
    const c = { id: 'z', source: 'R3', target: 'R4', sourceHandle: 'n', targetHandle: 'p' }
    const first = mergeEdges([], [a, b]).edges
    const { edges, leaving } = mergeEdges(first, [b, c])
    expect(edges.find((edge) => edgeKey(edge) === edgeKey(b))?.className).toBe('')
    expect(edges.find((edge) => edgeKey(edge) === edgeKey(c))?.className).toBe('demo-edge-enter')
    expect(edges.find((edge) => edgeKey(edge) === edgeKey(a))?.className).toBe('demo-edge-leave')
    expect(leaving).toHaveLength(1)
  })

  it('插值两端落在起点和终点，包围盒覆盖全部元件', () => {
    const moves = [{ id: 'R1', from: { x: 0, y: 0 }, to: { x: 100, y: 40 } }]
    expect(interpolate(moves, 0).get('R1')).toEqual({ x: 0, y: 0 })
    expect(interpolate(moves, 1).get('R1')).toEqual({ x: 100, y: 40 })
    expect(unionBounds([{ x: -50, y: 10 }, { x: 300, y: 200 }], { width: 100, height: 100 })).toEqual({ x: -110, y: -60, width: 570, height: 430 })
  })
})

// 例 3-1 的网孔 1：Us1（− 进）→ Ra（p 在下，从 + 进）→ Rb（上端是 −）→ Us2（+ 进）
const mesh: KvlLoop = {
  id: 'm1',
  name: '网孔 1',
  start: '左下角结点',
  elements: [{ id: 'Us1', enter: 'neg' }, { id: 'Ra', enter: 'p' }, { id: 'Rb', enter: 'n' }, { id: 'Us2', enter: 'pos' }],
}
const payload = {
  components: [
    { id: 'Us1', type: 'vsource_dc', parameters: { dc: 180 }, connections: { pos: 'a', neg: 'gnd' } },
    { id: 'Ra', type: 'resistor', parameters: { value: 60 }, connections: { p: 'a', n: 'top' } },
    { id: 'Rb', type: 'resistor', parameters: { value: 20 }, connections: { p: 'b', n: 'top' } },
    { id: 'Us2', type: 'vsource_dc', parameters: { dc: 70 }, connections: { pos: 'b', neg: 'gnd' } },
  ],
} as never
const voltages = { a: 180, top: 60, b: 70, gnd: 0 }
const labels = { Us1: 'Us1', Ra: 'Ra', Rb: 'Rb', Us2: 'Us2' }

describe('KVL', () => {
  it('两端元件的出口自动取另一端；多端元件必须写明', () => {
    expect(exitOf({ id: 'R', enter: 'p' })).toBe('n')
    expect(exitOf({ id: 'V', enter: 'neg' })).toBe('pos')
    expect(() => exitOf({ id: 'F', enter: 'ctrl_p' })).toThrow()
  })

  it('从 + 端进记 +u、从 − 端进记 −u；电位沿途变化，走完一圈回到 0', () => {
    const terms = loopTerms(mesh, 'cw', payload, voltages, labels)
    // Rb 的 p 端接 b、n 端接上母线：绕行从 n（−）端进入，所以记 −u_Rb
    expect(terms.map((term) => term.sign)).toEqual([-1, 1, -1, 1])
    expect(terms.map((term) => term.contribution)).toEqual([-180, 120, -10, 70])
    expect(terms.map((term) => term.after)).toEqual([180, 60, 70, 0])
    expect(terms.reduce((sum, term) => sum + term.contribution, 0)).toBeCloseTo(0, 9)
  })

  it('逆时针：元件倒序、进出对调，每一项变号', () => {
    expect(orientLoop(mesh, 'ccw').map((element) => `${element.id}:${element.enter}`)).toEqual(['Us2:neg', 'Rb:p', 'Ra:n', 'Us1:pos'])
    const cw = loopTerms(mesh, 'cw', payload, voltages, labels).map((term) => term.contribution)
    const ccw = loopTerms(mesh, 'ccw', payload, voltages, labels).map((term) => term.contribution)
    expect(ccw).toEqual(cw.reverse().map((value) => -value))
  })

  it('回路闭合检查：相邻元件必须接在同一个结点上', () => {
    expect(loopIsClosed(mesh, payload)).toBeNull()
    const broken: KvlLoop = { ...mesh, elements: [mesh.elements[0], mesh.elements[2], mesh.elements[1], mesh.elements[3]] }
    expect(loopIsClosed(broken, payload)).toMatch(/不在同一个结点|没接/)
  })

  it('一项的三种写法：符号、欧姆定律、代入值（负值带括号）', () => {
    const nodes = [node('Rd', 'resistor', 0, 0, { value: 40 })]
    const term = { id: 'Rd', label: 'Rd', enter: 'n', exit: 'p', sign: -1 as const, u: -40, contribution: 40, before: 0, after: 0 }
    expect(termTexts(term, nodes, [{ name: 'Id', elements: ['Rd'], ref: 'Rd' }])).toEqual({ symbol: '−u_Rd', law: 'u_Rd = 40·Id', substituted: '−(−40)' })
    expect(formatNumber(119.99999999)).toBe('120')
    expect(formatNumber(-1e-14)).toBe('0')
  })
})

describe('读数', () => {
  it('取倒数 / 取负 / 有效值，并按 expect、tol 判断', () => {
    const data = { branch_currents: { Us: -0.0666667 } }
    const p = { components: [] }
    expect(evaluateValue({ path: 'branch_currents.Us', transform: 'negate', expect: 0.0666667, tol: 1e-7 }, p, data)).toMatchObject({ ok: true })
    expect(evaluateValue({ path: 'branch_currents.Us', transform: 'reciprocal' }, p, data).actual).toBeCloseTo(-15, 3)
    expect(evaluateValue({ path: 'nope', expect: 1, tol: 0 }, p, data).ok).toBe(false)
  })

  it('讲解文字里的 {key} 换成带单位的读数；还没算出来显示省略号', () => {
    const outcome = { value: { key: 'uoc', label: 'Uoc', path: 'vth', unit: 'V', expect: 0, tol: 0 }, actual: 0.0013866, ok: true }
    expect(fillText('Uoc = {uoc}', [outcome])).toBe('Uoc = 1.387 mV')
    expect(fillText('Uoc = {uoc}', undefined)).toBe('Uoc = …')
  })

  it('端子中心 = 节点绝对位置 + 句柄框中心', () => {
    const internal = {
      internals: { positionAbsolute: { x: 100, y: 50 }, handleBounds: { source: [{ id: 'p', x: -9, y: 40, width: 18, height: 18, position: 'left' }], target: [] } },
      measured: { width: 160, height: 100 },
    } as never
    expect(terminalPoint(internal, 'p')).toEqual({ x: 100, y: 99 })
    expect(terminalPoint(internal, 'n')).toBeNull()
  })
})
