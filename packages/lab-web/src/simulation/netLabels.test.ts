import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import type { CircuitNodeData } from '@/types/circuit'
import { componentRowLabel, describeNets, withNetLabel } from './netLabels'

function node(id: string, type: string, label = id): Node<CircuitNodeData> {
  return { id, type, position: { x: 0, y: 0 }, data: { label, type: type as CircuitNodeData['type'], parameters: {} } }
}

describe('结果表行名', () => {
  const nodes = [node('V1', 'vsource_dc', 'Us'), node('R1', 'resistor'), node('R2', 'resistor'), node('R3', 'resistor'), node('VP1', 'voltage_probe', 'a'), node('G1', 'ground')]
  const nets = [
    { name: 'n1', nodes: [['V1', 'pos'], ['R1', 'p'], ['VP1', 'node']] as [string, string][] },
    { name: 'n2', nodes: [['R1', 'n'], ['R2', 'p'], ['R3', 'p']] as [string, string][] },
    { name: 'gnd', nodes: [['V1', 'neg'], ['R2', 'n'], ['G1', 'gnd']] as [string, string][] },
  ]

  it('挂了探针用探针名，接地叫「地」，其余列头两个元件端子', () => {
    expect(describeNets(nodes, nets)).toEqual({ n1: '探针 a', n2: 'R1.n、R2.p 等', gnd: '地' })
  })

  it('网络名后括上说明；元件 id 与标签不同才括', () => {
    expect(withNetLabel('n1', { n1: '探针 a' })).toBe('n1（探针 a）')
    expect(withNetLabel('n9', {})).toBe('n9')
    expect(componentRowLabel('V1', { V1: 'Us' })).toBe('V1（Us）')
    expect(componentRowLabel('R1', { R1: 'R1' })).toBe('R1')
  })
})
