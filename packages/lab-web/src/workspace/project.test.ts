import { describe, expect, it } from 'vitest'

import { loadProjectFromObject, PROJECT_SCHEMA, wrapProject } from './project'

const bareProject = {
  nodes: [
    {
      id: 'R1',
      type: 'resistor',
      position: { x: 0, y: 0 },
      data: { label: 'R1', type: 'resistor', parameters: { value: 1000 } },
    },
  ],
  edges: [],
}

describe('统一工程文件信封 v1', () => {
  it('wrapProject 产出规范信封', () => {
    const envelope = wrapProject('circuit', 'demo', bareProject)
    expect(envelope.schema).toBe(PROJECT_SCHEMA)
    expect(envelope.kind).toBe('circuit')
    expect(envelope.app.module).toBe('lab')
    expect(envelope.payload).toBe(bareProject)
    expect(envelope.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('裸工程（旧格式）直接加载', () => {
    const result = loadProjectFromObject(bareProject)
    expect(result.ok).toBe(true)
    expect(result.nodes).toHaveLength(1)
  })

  it('circuit 信封拆包后加载', () => {
    const result = loadProjectFromObject(wrapProject('circuit', 'demo', bareProject))
    expect(result.ok).toBe(true)
    expect(result.nodes).toHaveLength(1)
  })

  it('grid 信封给出指路错误而非静默失败', () => {
    const result = loadProjectFromObject(wrapProject('grid', 'demo', { meta: {}, nodes: [], links: [] }))
    expect(result.ok).toBe(false)
    expect(result.errors.join('')).toContain('配电网实验室')
  })
})
