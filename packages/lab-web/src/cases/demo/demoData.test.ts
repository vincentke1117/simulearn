import { describe, expect, it } from 'vitest'

import { circuitComponentLibrary } from '@/circuit/components'
import { buildSimulationPayload } from '@/simulation/payload'
import { initialSimulationSettings } from '@/workspace/circuitWorkspaceHelpers'
import { resolveCheckPath } from '../checks'
import { caseCircuit, QIU_CASES } from '../library'
import { demoCircuit, stepProject, stepRequest, tableRequests } from './demoPayload'
import { loopIsClosed, loopTerms } from './kvl'
import { allDemoScriptKeys, demoScriptKey } from './loader'
import type { CaseDemoScript, KvlDemo, StepsDemo } from './types'

/** 离线门禁：演示数据自洽（数值对不对教材由 demos.e2e.test.ts 对着真实内核核对） */
const modules = import.meta.glob<{ default: CaseDemoScript }>('../demos/*.json', { eager: true })
const scripts = Object.entries(modules).map(([key, module]) => ({ key, script: module.default }))
const stepsScripts = scripts.filter((entry): entry is { key: string; script: StepsDemo } => entry.script.kind === 'steps')
const kvlScripts = scripts.filter((entry): entry is { key: string; script: KvlDemo } => entry.script.kind === 'kvl')

describe('演示索引与数据文件一一对应', () => {
  it('案例里登记的每个演示都有数据文件，每个数据文件都登记在它的案例里，kind 一致', () => {
    const registered = QIU_CASES.flatMap((item) => (item.demos ?? []).map((demo) => ({ item, demo })))
    expect(registered.length).toBeGreaterThan(0)
    for (const { item, demo } of registered) {
      expect(allDemoScriptKeys(), `${item.id}.${demo.id}`).toContain(demoScriptKey(item.id, demo.id))
      const script = modules[demoScriptKey(item.id, demo.id)].default
      expect(script.caseId).toBe(item.id)
      expect(script.id).toBe(demo.id)
      expect(script.kind).toBe(demo.kind)
    }
    expect(scripts.length).toBe(registered.length)
  })
})

describe.each(stepsScripts.map(({ key, script }) => [key, script] as const))('%s', (_, script) => {
  it('第一步有电路；每一步的电路都读得出来，元件参数名都是定义里有的', () => {
    expect(script.steps[0].circuit).toBeDefined()
    script.steps.forEach((_, index) => {
      const project = stepProject(script, index)
      for (const raw of project.nodes) {
        const definition = circuitComponentLibrary[raw.type as keyof typeof circuitComponentLibrary]
        expect(definition, `第 ${index + 1} 步 ${raw.id} 的类型 ${raw.type}`).toBeDefined()
        for (const key of Object.keys(raw.data.parameters)) expect(definition.parameters.map((p) => p.key), `${raw.id}.${key}`).toContain(key)
      }
      expect(() => demoCircuit(project)).not.toThrow()
    })
  })

  it('要算的步骤都构造得出请求，读数路径都找得到；讲解里的 {key} 都有对应读数', () => {
    script.steps.forEach((step, index) => {
      const build = stepRequest(script, index)
      if (step.values?.length) expect(build, `第 ${index + 1} 步有读数却没有 compute`).not.toBeNull()
      if (build) {
        expect(build.errors, `第 ${index + 1} 步`).toEqual([])
        for (const value of step.values ?? []) expect(resolveCheckPath(value.path, build.payload!), `第 ${index + 1} 步 ${value.path}`).toBeDefined()
      }
      const keys = [...step.text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1])
      for (const key of keys) expect(step.values?.map((value) => value.key), `第 ${index + 1} 步讲解里的 {${key}}`).toContain(key)
      for (const tableBuild of tableRequests(script, index)) expect(tableBuild.errors).toEqual([])
    })
  })

  it('高亮、淡显、气泡锚点、隐藏标签的元件都在本步电路里', () => {
    script.steps.forEach((step, index) => {
      const ids = new Set(stepProject(script, index).nodes.map((node) => node.id))
      for (const id of [...(step.highlight ?? []), ...(step.dim ?? []), ...(step.hideHandleLabels ?? [])]) expect(ids, `第 ${index + 1} 步 ${id}`).toContain(id)
      for (const note of step.notes ?? []) if (note.anchor) expect(ids, `第 ${index + 1} 步气泡 ${note.id}`).toContain(note.anchor)
    })
  })

  it('跨步保留的元件（同 id）类型和朝向不变：换朝向的话端子位置不会重新测量，连线会接错一侧', () => {
    for (let index = 1; index < script.steps.length; index += 1) {
      const previous = new Map(stepProject(script, index - 1).nodes.map((node) => [node.id, node]))
      for (const node of stepProject(script, index).nodes) {
        const old = previous.get(node.id)
        if (!old || old.type !== node.type) continue
        expect(node.data.rotation ?? 0, `第 ${index + 1} 步 ${node.id} 的朝向`).toBe(old.data.rotation ?? 0)
      }
    }
  })
})

describe.each(kvlScripts.map(({ key, script }) => [key, script] as const))('%s', (_, script) => {
  const item = QIU_CASES.find((entry) => entry.id === script.caseId)!
  const circuit = caseCircuit(item)
  const build = buildSimulationPayload(circuit.nodes, circuit.edges, { ...initialSimulationSettings, method: script.method })

  it('电路构造得出请求；支路的 ref 是电阻，支路和回路里的元件都在电路里', () => {
    expect(build.errors).toEqual([])
    const ids = new Set(circuit.nodes.map((node) => node.id))
    for (const branch of script.branches) {
      expect(circuit.nodes.find((node) => node.id === branch.ref)?.type).toBe('resistor')
      for (const id of branch.elements) expect(ids).toContain(id)
    }
    for (const loop of script.loops) for (const element of loop.elements) expect(ids, `${loop.name} ${element.id}`).toContain(element.id)
  })

  it('每个回路首尾闭合、相邻元件接在同一个结点；任意结点电压下顺、逆两个方向的和都是 0', () => {
    const payload = build.payload!
    const labels = Object.fromEntries(circuit.nodes.map((node) => [node.id, node.data.label]))
    const voltages = Object.fromEntries(payload.nets.map((net, i) => [net.name, net.name === 'gnd' ? 0 : 7.3 * (i + 1) - 11]))
    for (const loop of script.loops) {
      expect(loopIsClosed(loop, payload), loop.name).toBeNull()
      for (const direction of ['cw', 'ccw'] as const) {
        const sum = loopTerms(loop, direction, payload, voltages, labels).reduce((acc, term) => acc + term.contribution, 0)
        expect(sum, `${loop.name} ${direction}`).toBeCloseTo(0, 9)
      }
    }
  })
})
