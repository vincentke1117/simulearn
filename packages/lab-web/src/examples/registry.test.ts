import { describe, expect, it } from 'vitest'

import { circuitComponentLibrary } from '@/circuit/components'
import { buildControlSimulationPayload } from '@/simulation/controlPayload'
import { detectDiagramMode } from '@/simulation/diagramMode'
import { buildSimulationPayload } from '@/simulation/payload'
import { initialSimulationSettings } from '@/workspace/circuitWorkspaceHelpers'
import { loadProjectFromObject } from '@/workspace/project'
import { loadExamples } from './registry'

// 内置示例同时是知帆课堂里 {"example": id} 引用的电路：元件改了端子名或参数名，示例必须跟着改，
// 否则课堂里打开就是「R1 不存在端子 left」（三个电路示例曾停留在旧端子名 left / right / top、
// 旧参数名 voltage / resistance，一直没人发现）。这里只做前端能查的两道：端子名由构建请求时报错，
// 参数名要逐个比对——加载时不认识的参数会被悄悄换成默认值，构建请求照样成功。
describe('built-in examples', () => {
  it('use only parameter keys the components define, so no value silently falls back to a default', async () => {
    for (const example of await loadExamples()) {
      for (const node of example.data.nodes) {
        const definition = circuitComponentLibrary[node.type as keyof typeof circuitComponentLibrary]
        expect(definition, `${example.id}/${node.id}`).toBeDefined()
        const known = definition.parameters.map((parameter) => parameter.key)
        for (const key of Object.keys(node.data.parameters)) {
          expect(known, `${example.id}/${node.id} 的参数 ${key}`).toContain(key)
        }
      }
      const loaded = loadProjectFromObject(example.data)
      for (const node of loaded.nodes ?? []) {
        const raw = example.data.nodes.find((item) => item.id === node.id)
        for (const [key, value] of Object.entries(raw?.data.parameters ?? {})) {
          expect(node.data.parameters[key], `${example.id}/${node.id}.${key}`).toBe(value)
        }
      }
    }
  })

  it('load and build a simulation request without errors (terminal names checked here)', async () => {
    const examples = await loadExamples()
    expect(examples.length).toBeGreaterThan(0)
    for (const example of examples) {
      const loaded = loadProjectFromObject(example.data)
      expect(loaded.errors, example.id).toEqual([])
      const nodes = loaded.nodes ?? []
      const edges = loaded.edges ?? []
      const built = detectDiagramMode(nodes) === 'control'
        ? buildControlSimulationPayload(nodes, edges, initialSimulationSettings)
        : buildSimulationPayload(nodes, edges, initialSimulationSettings)
      expect(built.errors, example.id).toEqual([])
      expect(built.ok, example.id).toBe(true)
    }
  })
})
