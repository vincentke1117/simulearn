import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import type { CircuitNodeData, SimulationSettings } from '@/types/circuit'
import { buildSimulationPayload } from '@/simulation/payload'
import { loadProjectFromObject } from '@/workspace/project'

function node(id: string, type: string, parameters: Record<string, number> = {}): Node<CircuitNodeData> {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, type: type as CircuitNodeData['type'], parameters } }
}
function edge(id: string, s: string, sh: string, t: string, th: string): Edge {
  return { id, source: s, target: t, sourceHandle: sh, targetHandle: th }
}

const settings: SimulationSettings = { tStop: 5e-3, nSamples: 101 }

/** C1 与 R1 并联接地：没有电源，只靠电容初始电压放电（contracts/lab/transient-rc-discharge.json 同一拓扑） */
function discharge(v0: number | undefined) {
  const capacitor: Record<string, number> = v0 === undefined ? { value: 1e-6 } : { value: 1e-6, v0 }
  return {
    nodes: [node('C1', 'capacitor', capacitor), node('R1', 'resistor', { value: 1000 }), node('G1', 'ground'), node('VP1', 'voltage_probe')],
    edges: [
      edge('e1', 'C1', 'p', 'R1', 'p'),
      edge('e2', 'C1', 'n', 'G1', 'gnd'),
      edge('e3', 'R1', 'n', 'G1', 'gnd'),
      edge('e4', 'VP1', 'node', 'C1', 'p'),
    ],
  }
}

describe('储能元件初始值与交流源初相', () => {
  it('没有电源但电容有初始电压：可以做瞬态（零输入响应），v0 原样发给内核', () => {
    const { nodes, edges } = discharge(10)
    const result = buildSimulationPayload(nodes, edges, settings)
    expect(result.errors).toEqual([])
    expect(result.payload?.components.find((c) => c.id === 'C1')?.parameters).toEqual({ value: 1e-6, v0: 10 })
  })

  it('零输入电路选了稳态类方法：提交前就拦下，说清楚要用瞬态', () => {
    const { nodes, edges } = discharge(10)
    const result = buildSimulationPayload(nodes, edges, { ...settings, method: 'dc_op' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('零输入响应')
  })

  it('初始值为 0 又没有电源：照旧报缺电源', () => {
    const { nodes, edges } = discharge(0)
    const result = buildSimulationPayload(nodes, edges, settings)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('至少一个电源')
  })

  it('旧电路里没有可选参数的键：不报错，也不发这个键（内核按 0 处理）', () => {
    const { nodes, edges } = discharge(undefined)
    nodes.push(node('V1', 'vsource_ac', { amplitude: 1, frequency: 50 }))
    edges.push(edge('e5', 'V1', 'pos', 'R1', 'p'), edge('e6', 'V1', 'neg', 'G1', 'gnd'))
    const result = buildSimulationPayload(nodes, edges, settings)
    expect(result.errors).toEqual([])
    expect(result.payload?.components.find((c) => c.id === 'C1')?.parameters).toEqual({ value: 1e-6 })
    expect(result.payload?.components.find((c) => c.id === 'V1')?.parameters).toEqual({ amplitude: 1, frequency: 50 })
  })

  it('可选参数填成非数：照样拦下', () => {
    const { nodes, edges } = discharge(Number.NaN)
    const result = buildSimulationPayload(nodes, edges, settings)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('初始电压')
  })

  it('读旧工程文件时补上缺省值 0', () => {
    const loaded = loadProjectFromObject({
      nodes: [{ id: 'V1', type: 'vsource_ac', position: { x: 0, y: 0 }, data: { label: 'V1', type: 'vsource_ac', parameters: { amplitude: 1, frequency: 50 } } }],
      edges: [],
    })
    expect(loaded.nodes?.[0]?.data.parameters).toEqual({ amplitude: 1, frequency: 50, phase: 0 })
  })
})

describe('无源元件的值不能为 0', () => {
  it('电阻填 0 Ω：提交前拦下并说清怎么短路（内核遇到会报内部错误）', () => {
    const { nodes, edges } = discharge(10)
    nodes[1] = node('R1', 'resistor', { value: 0 })
    const result = buildSimulationPayload(nodes, edges, settings)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('R1 的阻值不能为 0')
  })
})

describe('旋转只是外观', () => {
  it('转 180 度的电压源，请求里的端子和画布上的一样（原先会再对调一次，直流 / 相量与瞬态极性相反）', () => {
    const nodes = [node('V1', 'vsource_dc', { dc: 5 }), node('R1', 'resistor', { value: 1000 }), node('G1', 'ground')]
    nodes[0] = { ...nodes[0], data: { ...nodes[0].data, rotation: 180 } }
    const edges = [edge('e1', 'V1', 'pos', 'R1', 'p'), edge('e2', 'V1', 'neg', 'G1', 'gnd'), edge('e3', 'R1', 'n', 'G1', 'gnd')]
    const result = buildSimulationPayload(nodes, edges, { ...settings, method: 'node_voltage' })
    const v1 = result.payload?.components.find((c) => c.id === 'V1')
    const net = (id: string, handle: string) => result.payload?.nets.find((n) => n.nodes.some(([a, b]) => a === id && b === handle))?.name
    expect(v1?.connections).toEqual({ pos: net('V1', 'pos'), neg: net('V1', 'neg') })
    expect(v1?.connections.neg).toBe('gnd')
  })
})

describe('0 F 电容：相量分析里就是开路，可以算；瞬态不行', () => {
  function rcAc() {
    return {
      nodes: [node('VAC1', 'vsource_ac', { amplitude: 1, frequency: 50 }), node('R1', 'resistor', { value: 10 }), node('C1', 'capacitor', { value: 0 }), node('G1', 'ground')],
      edges: [edge('e1', 'VAC1', 'pos', 'R1', 'p'), edge('e2', 'R1', 'n', 'C1', 'p'), edge('e3', 'C1', 'n', 'G1', 'gnd'), edge('e4', 'VAC1', 'neg', 'G1', 'gnd')],
    }
  }
  it('ac_phasor 放行', () => {
    const { nodes, edges } = rcAc()
    expect(buildSimulationPayload(nodes, edges, { ...settings, method: 'ac_phasor' }).errors).toEqual([])
  })
  it('瞬态拦下，并说明相量里可以', () => {
    const { nodes, edges } = rcAc()
    const result = buildSimulationPayload(nodes, edges, { ...settings, method: 'transient' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('不能做瞬态分析')
  })
})
