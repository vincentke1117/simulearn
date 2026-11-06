import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import type { CircuitNodeData } from '@/types/circuit'
import { applyOverlay, type SimulationNetPayload } from './mapping'

function node(id: string, type: string): Node<CircuitNodeData> {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, type: type as CircuitNodeData['type'], parameters: {} } }
}

const nets: SimulationNetPayload[] = [
  { name: 'n1', nodes: [['R1', 'n'], ['L1', 'p']] },
  { name: 'n2', nodes: [['L1', 'n'], ['C1', 'p']] },
  { name: 'gnd', nodes: [['C1', 'n'], ['G1', 'gnd']] },
]

describe('applyOverlay', () => {
  it('元件电压是两端结点电压（带符号的实数）之差', () => {
    const [inductor] = applyOverlay([node('L1', 'inductor')], nets, { n1: 5, n2: 2, gnd: 0 }, 'element')
    expect(inductor.data.voltage).toBe(3)
  })
})
