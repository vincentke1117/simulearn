import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import type { CircuitNodeData, SimulationSettings, SweepSettings } from '@/types/circuit'
import { defaultSweepSettings } from '@/types/circuit'
import {
  buildSimulationPayload,
  hasAcSource,
  hasProbe,
  toSweepPayload,
  validateAcMethod,
  validateSweepSettings,
} from '@/simulation/payload'

function createNode(id: string, type: string, parameters: Record<string, number> = {}): Node<CircuitNodeData> {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id, type: type as CircuitNodeData['type'], parameters },
  }
}

function createEdge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string): Edge {
  return { id, source, target, sourceHandle, targetHandle }
}

/**
 * RC 低通：VAC1(n1) - R1(n1→n2) - C1(n2→gnd)，VP1 探针挂在 n2，G1 接地。
 * 与 contracts/lab/freq-sweep-rc-lowpass.json 的拓扑一致。
 */
function rcLowpass() {
  const nodes = [
    createNode('VAC1', 'vsource_ac', { amplitude: 1, frequency: 1000 }),
    createNode('R1', 'resistor', { value: 1000 }),
    createNode('C1', 'capacitor', { value: 1.5915494309189535e-7 }),
    createNode('VP1', 'voltage_probe'),
    createNode('G1', 'ground'),
  ]
  const edges = [
    createEdge('e1', 'VAC1', 'pos', 'R1', 'p'),
    createEdge('e2', 'R1', 'n', 'C1', 'p'),
    createEdge('e3', 'C1', 'p', 'VP1', 'node'),
    createEdge('e4', 'C1', 'n', 'VAC1', 'neg'),
    createEdge('e5', 'VAC1', 'neg', 'G1', 'gnd'),
  ]
  return { nodes, edges }
}

const baseSettings: SimulationSettings = { tStop: 1e-3, nSamples: 10 }

const sweep: SweepSettings = { fStartHz: 100, fStopHz: 10000, nPoints: 3, scale: 'log' }

describe('validateSweepSettings', () => {
  it('accepts a valid log sweep', () => {
    expect(validateSweepSettings(sweep)).toEqual([])
    expect(validateSweepSettings(defaultSweepSettings)).toEqual([])
  })

  it('rejects a missing sweep block', () => {
    expect(validateSweepSettings(undefined).join(' ')).toContain('sweep 参数')
  })

  it('rejects f_start <= 0 (后端：频率扫描起始频率必须大于 0)', () => {
    expect(validateSweepSettings({ ...sweep, fStartHz: 0 }).join(' ')).toContain('起始频率必须大于 0')
    expect(validateSweepSettings({ ...sweep, fStartHz: -5 }).join(' ')).toContain('起始频率必须大于 0')
  })

  it('rejects f_stop <= f_start', () => {
    expect(validateSweepSettings({ ...sweep, fStartHz: 10000, fStopHz: 100 }).join(' ')).toContain(
      '终止频率必须大于起始频率',
    )
  })

  it('enforces the backend n_points range 2..401', () => {
    expect(validateSweepSettings({ ...sweep, nPoints: 1 }).join(' ')).toContain('2..401')
    expect(validateSweepSettings({ ...sweep, nPoints: 402 }).join(' ')).toContain('2..401')
    expect(validateSweepSettings({ ...sweep, nPoints: 10.5 }).join(' ')).toContain('2..401')
    expect(validateSweepSettings({ ...sweep, nPoints: 2 })).toEqual([])
    expect(validateSweepSettings({ ...sweep, nPoints: 401 })).toEqual([])
  })

  it('rejects non-log scale (v1 仅支持对数刻度)', () => {
    expect(
      validateSweepSettings({ ...sweep, scale: 'linear' as unknown as 'log' }).join(' '),
    ).toContain('仅支持对数刻度')
  })
})

describe('toSweepPayload', () => {
  it('maps camelCase settings to the backend snake_case shape', () => {
    expect(toSweepPayload(sweep)).toEqual({
      f_start_hz: 100,
      f_stop_hz: 10000,
      n_points: 3,
      scale: 'log',
    })
  })
})

describe('validateAcMethod', () => {
  it('accepts a circuit with a single AC source', () => {
    expect(validateAcMethod(rcLowpass().nodes)).toEqual([])
  })

  it('requires at least one AC source', () => {
    const nodes = [createNode('V1', 'vsource_dc', { dc: 5 }), createNode('R1', 'resistor', { value: 1000 })]
    expect(validateAcMethod(nodes).join(' ')).toContain('至少一个交流源')
  })

  it('rejects controlled sources (后端：AC 相量分析暂不支持受控源)', () => {
    const { nodes } = rcLowpass()
    nodes.push(createNode('E1', 'vcvs', { gain: 2 }))
    expect(validateAcMethod(nodes).join(' ')).toContain('不支持受控源')
    expect(validateAcMethod(nodes).join(' ')).toContain('E1')
  })

  it('rejects mismatched AC source frequencies', () => {
    const { nodes } = rcLowpass()
    nodes.push(createNode('VAC2', 'vsource_ac', { amplitude: 1, frequency: 50 }))
    expect(validateAcMethod(nodes).join(' ')).toContain('交流源频率不一致')
  })
})

describe('hasAcSource / hasProbe', () => {
  it('detects AC sources and probes on the canvas', () => {
    const { nodes } = rcLowpass()
    expect(hasAcSource(nodes)).toBe(true)
    expect(hasProbe(nodes)).toBe(true)
    expect(hasAcSource([createNode('R1', 'resistor', { value: 1 })])).toBe(false)
    expect(hasProbe([createNode('R1', 'resistor', { value: 1 })])).toBe(false)
  })

  it('counts current probes too', () => {
    expect(hasProbe([createNode('IP1', 'current_probe')])).toBe(true)
  })
})

describe('buildSimulationPayload — frequency_sweep', () => {
  it('emits the sweep block at the top level next to method', () => {
    const { nodes, edges } = rcLowpass()
    const result = buildSimulationPayload(nodes, edges, {
      ...baseSettings,
      method: 'frequency_sweep',
      sweep,
    })

    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.payload?.method).toBe('frequency_sweep')
    expect(result.payload?.sweep).toEqual({ f_start_hz: 100, f_stop_hz: 10000, n_points: 3, scale: 'log' })
  })

  it('blocks the request when there is no probe (别让学生吃 422)', () => {
    const { nodes, edges } = rcLowpass()
    const withoutProbe = nodes.filter((node) => node.id !== 'VP1')
    const edgesWithoutProbe = edges.filter((edge) => edge.id !== 'e3')

    const result = buildSimulationPayload(withoutProbe, edgesWithoutProbe, {
      ...baseSettings,
      method: 'frequency_sweep',
      sweep,
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('频率扫描需要至少一个探针')
  })

  it('blocks an out-of-range n_points before hitting the backend', () => {
    const { nodes, edges } = rcLowpass()
    const result = buildSimulationPayload(nodes, edges, {
      ...baseSettings,
      method: 'frequency_sweep',
      sweep: { ...sweep, nPoints: 500 },
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('2..401')
    expect(result.payload).toBeUndefined()
  })

  it('does not attach a sweep block to non-sweep methods', () => {
    const { nodes, edges } = rcLowpass()
    const result = buildSimulationPayload(nodes, edges, { ...baseSettings, method: 'ac_phasor', sweep })

    expect(result.ok).toBe(true)
    expect(result.payload?.method).toBe('ac_phasor')
    expect(result.payload?.sweep).toBeUndefined()
  })
})

describe('buildSimulationPayload — method selection', () => {
  it('honours settings.method (此前工具栏选的方法被整个丢掉了)', () => {
    const { nodes, edges } = rcLowpass()
    const result = buildSimulationPayload(nodes, edges, { ...baseSettings, method: 'dc_op' })

    expect(result.ok).toBe(true)
    expect(result.payload?.method).toBe('dc_op')
  })

  it('still auto-detects when no method is set', () => {
    const { nodes, edges } = rcLowpass()
    const result = buildSimulationPayload(nodes, edges, baseSettings)

    // 含电容/交流源 → 非纯电阻 → transient
    expect(result.payload?.method).toBe('transient')
  })
})
