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

    expect(result.ok).toBe(true)
    expect(result.payload?.kind).toBe('mixed')
    expect(result.payload?.bridges).toHaveLength(2)
    expect(result.payload?.outputs).toHaveLength(1)
    expect(result.payload?.circuit.components.some((component) => component.id === 'R1')).toBe(true)
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
