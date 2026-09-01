import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import type { CircuitNodeData, SimulationSettings } from '@/types/circuit'
import { buildMixedSimulationPayload } from '@/simulation/mixedPayload'

function createNode(
  id: string,
  type: string,
  parameters: Record<string, number> = {},
): Node<CircuitNodeData> {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      label: id,
      type: type as CircuitNodeData['type'],
      parameters,
    },
  }
}

function createEdge(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): Edge {
  return {
    id,
    source,
    target,
    sourceHandle,
    targetHandle,
  }
}

const settings: SimulationSettings = {
  tStop: 1,
  nSamples: 100,
}

describe('buildMixedSimulationPayload', () => {
  it('builds payload for a valid bridge closed-loop graph', () => {
    const nodes = [
      createNode('STEP1', 'control_step', { amplitude: 1, offset: 0, startTime: 0 }),
      createNode('SUM1', 'control_sum', { sign1: 1, sign2: -1 }),
      createNode('K1', 'control_gain', { gain: 1 }),
      createNode('CVS1', 'controlled_voltage_source', { gain: 1 }),
      createNode('VSEN1', 'voltage_sensor'),
      createNode('SCOPE1', 'control_scope'),
      createNode('R1', 'resistor', { value: 1000 }),
      createNode('R2', 'resistor', { value: 1000 }),
      createNode('G1', 'ground'),
    ]

    const edges = [
      createEdge('sig-1', 'STEP1', 'out', 'SUM1', 'in1'),
      createEdge('sig-2', 'VSEN1', 'out', 'SUM1', 'in2'),
      createEdge('sig-3', 'SUM1', 'out', 'K1', 'in'),
      createEdge('sig-4', 'K1', 'out', 'CVS1', 'in'),
      createEdge('sig-5', 'VSEN1', 'out', 'SCOPE1', 'in'),
      createEdge('ele-1', 'CVS1', 'pos', 'R1', 'p'),
      createEdge('ele-2', 'R1', 'n', 'R2', 'p'),
      createEdge('ele-3', 'CVS1', 'neg', 'G1', 'gnd'),
      createEdge('ele-4', 'R2', 'n', 'G1', 'gnd'),
      createEdge('ele-5', 'VSEN1', 'p', 'R2', 'p'),
      createEdge('ele-6', 'VSEN1', 'n', 'G1', 'gnd'),
    ]

    const result = buildMixedSimulationPayload(nodes, edges, settings)

    expect(result).toEqual({
      ok: true,
      errors: [],
      payload: {
        kind: 'mixed',
        blocks: [
          { id: 'STEP1', type: 'control_step', parameters: { amplitude: 1, offset: 0, startTime: 0 } },
          { id: 'SUM1', type: 'control_sum', parameters: { sign1: 1, sign2: -1 } },
          { id: 'K1', type: 'control_gain', parameters: { gain: 1 } },
          { id: 'CVS1', type: 'controlled_voltage_source', parameters: { gain: 1 } },
          { id: 'VSEN1', type: 'voltage_sensor', parameters: {} },
          { id: 'SCOPE1', type: 'control_scope', parameters: {} },
        ],
        edges: [
          { id: 'sig-1', source: 'STEP1', target: 'SUM1', sourceHandle: 'out', targetHandle: 'in1' },
          { id: 'sig-2', source: 'VSEN1', target: 'SUM1', sourceHandle: 'out', targetHandle: 'in2' },
          { id: 'sig-3', source: 'SUM1', target: 'K1', sourceHandle: 'out', targetHandle: 'in' },
          { id: 'sig-4', source: 'K1', target: 'CVS1', sourceHandle: 'out', targetHandle: 'in' },
          { id: 'sig-5', source: 'VSEN1', target: 'SCOPE1', sourceHandle: 'out', targetHandle: 'in' },
        ],
        outputs: [{ id: 'SCOPE1:in', blockId: 'SCOPE1', handle: 'in', label: 'Scope SCOPE1' }],
        bridges: [
          { blockId: 'CVS1', positiveNet: 'n1', negativeNet: 'gnd' },
          { blockId: 'VSEN1', positiveNet: 'n2', negativeNet: 'gnd' },
        ],
        circuit: {
          components: [
            { id: 'R1', type: 'resistor', parameters: { value: 1000 }, connections: { p: 'n1', n: 'n2' } },
            { id: 'R2', type: 'resistor', parameters: { value: 1000 }, connections: { p: 'n2', n: 'gnd' } },
            { id: 'G1', type: 'ground', parameters: {}, connections: { gnd: 'gnd' } },
          ],
          nets: [
            { name: 'n1', nodes: [['CVS1', 'pos'], ['R1', 'p']] },
            { name: 'n2', nodes: [['R1', 'n'], ['R2', 'p'], ['VSEN1', 'p']] },
            { name: 'gnd', nodes: [['CVS1', 'neg'], ['G1', 'gnd'], ['R2', 'n'], ['VSEN1', 'n']] },
          ],
        },
        sim: { t_stop: 1, n_samples: 100 },
      },
    })
  })

  it('preserves settings errors before the empty-canvas early return', () => {
    const result = buildMixedSimulationPayload([], [], { tStop: 0, nSamples: 1.5 })

    expect(result).toEqual({
      ok: false,
      errors: [
        '仿真时长必须大于 0',
        '采样点数至少为 2 且必须为整数',
        '请先在画布中放置元件',
      ],
    })
  })

  it('preserves edge-validation error order', () => {
    const nodes = [
      createNode('STEP1', 'control_step', { amplitude: 1, offset: 0, startTime: 0 }),
      createNode('CVS1', 'controlled_voltage_source', { gain: 1 }),
      createNode('R1', 'resistor', { value: 1000 }),
    ]
    const edges: Edge[] = [
      { id: 'missing-handles', source: 'STEP1', target: 'CVS1' },
      createEdge('missing-node', 'STEP1', 'out', 'UNKNOWN', 'in'),
      createEdge('cross-domain', 'STEP1', 'out', 'R1', 'p'),
    ]

    const result = buildMixedSimulationPayload(nodes, edges, settings)

    expect(result.ok).toBe(false)
    expect(result.errors.slice(0, 3)).toEqual([
      '连线 missing-handles 缺少端口信息',
      '连线 missing-node 引用了不存在的元件',
      '连线 cross-domain 不能跨域连接（电气端口与信号端口不能直接相连）',
    ])
  })

  it('rejects direct signal-to-electrical cross-domain connections', () => {
    const nodes = [
      createNode('STEP1', 'control_step', { amplitude: 1, offset: 0, startTime: 0 }),
      createNode('R1', 'resistor', { value: 1000 }),
      createNode('G1', 'ground'),
    ]

    const edges = [createEdge('bad-1', 'STEP1', 'out', 'R1', 'p')]
    const result = buildMixedSimulationPayload(nodes, edges, settings)

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('跨域')
  })

  it('rejects unsupported electrical dynamic components in mixed mode', () => {
    const nodes = [
      createNode('STEP1', 'control_step', { amplitude: 1, offset: 0, startTime: 0 }),
      createNode('CVS1', 'controlled_voltage_source', { gain: 1 }),
      createNode('VSEN1', 'voltage_sensor'),
      createNode('C1', 'capacitor', { value: 1e-6 }),
      createNode('G1', 'ground'),
    ]

    const edges = [
      createEdge('sig-1', 'STEP1', 'out', 'CVS1', 'in'),
      createEdge('ele-1', 'CVS1', 'pos', 'C1', 'p'),
      createEdge('ele-2', 'CVS1', 'neg', 'G1', 'gnd'),
      createEdge('ele-3', 'VSEN1', 'p', 'C1', 'p'),
      createEdge('ele-4', 'VSEN1', 'n', 'G1', 'gnd'),
    ]

    const result = buildMixedSimulationPayload(nodes, edges, settings)

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('暂不支持电气元件')
  })
})
