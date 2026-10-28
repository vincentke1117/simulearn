import { describe, expect, it } from 'vitest'

import type { AnalysisResultData } from '@/types/circuit'
import { describeAutoReference, pickAutoReference } from './autoReference'

const divider = {
  node_voltages: { n1: 5, n2: 2.5, n3: 0 },
  branch_currents: { R1: 0.0025 },
  reference: [{ net: 'n3', component: 'vsource_dc-1', terminal: 'neg' }],
} as unknown as AnalysisResultData

describe('pickAutoReference', () => {
  it('reads the reference points the kernel attaches when the circuit has no ground', () => {
    expect(pickAutoReference(divider)).toEqual([{ net: 'n3', component: 'vsource_dc-1', terminal: 'neg' }])
  })

  it('returns null for grounded results and empty results', () => {
    expect(pickAutoReference({ node_voltages: { gnd: 0 }, branch_currents: {} } as AnalysisResultData)).toBeNull()
    expect(pickAutoReference(null)).toBeNull()
  })

  it('looks inside comparison results', () => {
    const comparison = { node_voltage: divider, branch_current: null } as AnalysisResultData
    expect(pickAutoReference(comparison)?.[0].net).toBe('n3')
  })
})

describe('describeAutoReference', () => {
  const labels = { 'vsource_dc-1': 'V1', 'vcvs-1': 'E1' }

  it('names the source terminal by its canvas label', () => {
    const text = describeAutoReference(pickAutoReference(divider) ?? [], labels, false)
    expect(text).toContain('电路没有接地，已自动取 V1 的负极（节点 n3）作参考点（0 V）')
    expect(text).toContain('元件两端的电压和支路电流与参考点选在哪无关')
  })

  it('lists one point per isolated part, and says which parts are cut off from ground', () => {
    const points = [
      { net: 'a0', component: 'vsource_dc-1', terminal: 'neg' },
      { net: 'b0', component: 'vcvs-1', terminal: 'neg' },
    ]
    expect(describeAutoReference(points, labels, false)).toContain('电路分成 2 部分互不导通，都没有接地，已各自取参考点（0 V）：V1 的负极（节点 a0）、E1 的负极（节点 b0）')
    expect(describeAutoReference(points.slice(1), labels, true)).toContain('有一部分电路和地线不导通，已自动取 E1 的负极（节点 b0）作它的参考点')
  })

  it('falls back to the node name when no source picked the reference', () => {
    expect(describeAutoReference([{ net: 'n1', component: null, terminal: null }], {}, false)).toContain('已自动取 节点 n1 作参考点（0 V）')
  })
})
