import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'

import type { CircuitNodeData } from '@/types/circuit'
import { detectDiagramMode } from '@/simulation/diagramMode'

function createNode(id: string, type: string): Node<CircuitNodeData> {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      label: id,
      type: type as CircuitNodeData['type'],
      parameters: {},
    },
  }
}

describe('detectDiagramMode', () => {
  it('returns control for control-only diagrams', () => {
    const mode = detectDiagramMode([
      createNode('STEP1', 'control_step'),
      createNode('SCOPE1', 'control_scope'),
    ])
    expect(mode).toBe('control')
  })

  it('returns electrical for electrical-only diagrams', () => {
    const mode = detectDiagramMode([
      createNode('V1', 'vsource_dc'),
      createNode('R1', 'resistor'),
    ])
    expect(mode).toBe('electrical')
  })

  it('returns mixed when diagram includes both families', () => {
    const mode = detectDiagramMode([
      createNode('STEP1', 'control_step'),
      createNode('R1', 'resistor'),
    ])
    expect(mode).toBe('mixed')
  })

  it('returns mixed when bridge components are present', () => {
    const mode = detectDiagramMode([
      createNode('VSEN1', 'voltage_sensor'),
      createNode('R1', 'resistor'),
    ])
    expect(mode).toBe('mixed')
  })
})
