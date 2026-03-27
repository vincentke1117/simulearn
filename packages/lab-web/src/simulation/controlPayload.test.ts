import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import type { CircuitNodeData, SimulationSettings } from '@/types/circuit'
import { buildControlSimulationPayload } from '@/simulation/controlPayload'

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
  tStop: 2,
  nSamples: 200,
}

describe('buildControlSimulationPayload', () => {
  it('builds payload for a valid step-gain-plant-scope graph', () => {
    const nodes = [
      createNode('STEP1', 'control_step', { amplitude: 1, offset: 0, startTime: 0 }),
      createNode('K1', 'control_gain', { gain: 2 }),
      createNode('P1', 'control_plant_1st', { gain: 1, timeConstant: 0.1, initialValue: 0 }),
      createNode('SCOPE1', 'control_scope'),
    ]
    const edges = [
      createEdge('e1', 'STEP1', 'out', 'K1', 'in'),
      createEdge('e2', 'K1', 'out', 'P1', 'in'),
      createEdge('e3', 'P1', 'out', 'SCOPE1', 'in'),
    ]

    const result = buildControlSimulationPayload(nodes, edges, settings)

    expect(result.ok).toBe(true)
    expect(result.payload?.kind).toBe('control')
    expect(result.payload?.blocks).toHaveLength(4)
    expect(result.payload?.outputs).toHaveLength(1)
  })

  it('rejects graphs without scope blocks', () => {
    const nodes = [
      createNode('STEP1', 'control_step', { amplitude: 1, offset: 0, startTime: 0 }),
      createNode('K1', 'control_gain', { gain: 2 }),
    ]
    const edges = [createEdge('e1', 'STEP1', 'out', 'K1', 'in')]

    const result = buildControlSimulationPayload(nodes, edges, settings)

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('示波器')
  })

  it('rejects unconnected required inputs', () => {
    const nodes = [
      createNode('STEP1', 'control_step', { amplitude: 1, offset: 0, startTime: 0 }),
      createNode('K1', 'control_gain', { gain: 2 }),
      createNode('SCOPE1', 'control_scope'),
    ]
    const edges = [createEdge('e1', 'STEP1', 'out', 'SCOPE1', 'in')]

    const result = buildControlSimulationPayload(nodes, edges, settings)

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('K1')
    expect(result.errors.join(' ')).toContain('in')
  })

  it('rejects mixed electrical/control diagrams', () => {
    const nodes = [
      createNode('STEP1', 'control_step', { amplitude: 1, offset: 0, startTime: 0 }),
      createNode('R1', 'resistor', { value: 1000 }),
    ]
    const edges: Edge[] = []

    const result = buildControlSimulationPayload(nodes, edges, settings)

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('混合')
  })

  it('rejects pure algebraic control loops', () => {
    const nodes = [
      createNode('STEP1', 'control_step', { amplitude: 1, offset: 0, startTime: 0 }),
      createNode('SUM1', 'control_sum', { sign1: 1, sign2: -1 }),
      createNode('K1', 'control_gain', { gain: 2 }),
      createNode('SCOPE1', 'control_scope'),
    ]
    const edges = [
      createEdge('e1', 'STEP1', 'out', 'SUM1', 'in1'),
      createEdge('e2', 'K1', 'out', 'SUM1', 'in2'),
      createEdge('e3', 'SUM1', 'out', 'K1', 'in'),
      createEdge('e4', 'K1', 'out', 'SCOPE1', 'in'),
    ]

    const result = buildControlSimulationPayload(nodes, edges, settings)

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('代数环')
  })
})
