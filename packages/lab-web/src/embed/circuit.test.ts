import { beforeEach, describe, expect, it } from 'vitest'

import { wrapProject } from '@/workspace/project'
import { clearDraft, readDraft, resolveCircuit, writeDraft } from './circuit'
import { circuitSignature } from './protocol'

const prefix = 'slp:lab:exp:lab-1:'

const divider = {
  nodes: [
    { id: 'V1', type: 'vsource_dc', position: { x: 0, y: 0 }, data: { label: 'V1', type: 'vsource_dc', parameters: { dc: 5 } } },
    { id: 'R1', type: 'resistor', position: { x: 100, y: 0 }, data: { label: 'R1', type: 'resistor', parameters: { value: 1000 } } },
  ],
  edges: [{ id: 'e1', source: 'V1', target: 'R1', sourceHandle: 'pos', targetHandle: 'p' }],
}

describe('resolveCircuit', () => {
  it('opens a simulearn.project/1 envelope, with step-bridge edges like an import', async () => {
    const circuit = await resolveCircuit({ experiment: 'lab-1', project: wrapProject('circuit', 'x', divider), task: null })
    expect(circuit.nodes.map((node) => node.id)).toEqual(['V1', 'R1'])
    expect(circuit.edges[0].type).toBe('stepBridge')
  })

  it('opens a built-in example by id', async () => {
    const circuit = await resolveCircuit({ experiment: 'lab-1', project: { example: 'voltage-divider' }, task: null })
    expect(circuit.nodes.length).toBeGreaterThan(0)
  })

  it('explains what is wrong instead of opening an empty canvas', async () => {
    await expect(resolveCircuit({ experiment: 'lab-1', project: { example: 'nope' }, task: null })).rejects.toThrow('nope')
    await expect(resolveCircuit({ experiment: 'lab-1', project: wrapProject('grid', 'g', {}), task: null })).rejects.toThrow('配电网')
    await expect(resolveCircuit({ experiment: 'lab-1', project: { nodes: [] }, task: null })).rejects.toThrow('实验电路读不出来')
  })
})

describe('embed drafts', () => {
  beforeEach(() => localStorage.clear())

  it('keeps only real changes, bound to the course project fingerprint', async () => {
    const circuit = await resolveCircuit({ experiment: 'lab-1', project: wrapProject('circuit', 'x', divider), task: null })
    const baseline = circuitSignature(circuit.nodes, circuit.edges)

    // 只挪了位置：不算修改，不留草稿
    const moved = circuit.nodes.map((node) => ({ ...node, position: { x: node.position.x + 40, y: 80 } }))
    writeDraft(prefix, 'f1', baseline, moved, circuit.edges)
    expect(localStorage.getItem(prefix + 'draft-v1')).toBeNull()

    const changed = circuit.nodes.map((node) =>
      node.id === 'R1' ? { ...node, data: { ...node.data, parameters: { value: 2200 } } } : node)
    writeDraft(prefix, 'f1', baseline, changed, circuit.edges)
    expect(readDraft(prefix, 'f1')?.nodes.find((node) => node.id === 'R1')?.data.parameters.value).toBe(2200)
    // 课程电路换了版本：旧草稿不再恢复
    expect(readDraft(prefix, 'f2')).toBeNull()
    // 别的实验看不到
    expect(readDraft('slp:lab:exp:other:', 'f1')).toBeNull()

    // 改回原样：草稿删掉
    writeDraft(prefix, 'f1', baseline, circuit.nodes, circuit.edges)
    expect(localStorage.getItem(prefix + 'draft-v1')).toBeNull()

    writeDraft(prefix, 'f1', baseline, changed, circuit.edges)
    clearDraft(prefix)
    expect(readDraft(prefix, 'f1')).toBeNull()
  })

  it('falls back to the course circuit when the draft is corrupt', () => {
    localStorage.setItem(prefix + 'draft-v1', '{broken')
    expect(readDraft(prefix, 'f1')).toBeNull()
  })
})
