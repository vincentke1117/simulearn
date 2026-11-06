import { describe, expect, it } from 'vitest'

import { circuitComponentLibrary } from '@/circuit/components'
import { resolveCheckPath, resolveTheveninPort } from './checks'
import { CASE_LIBRARIES, QIU_CASES, caseCircuit, casePayload, findLibrary } from './library'

/** 离线门禁：案例数据自洽（数值是否对得上教材由 cases.e2e.test.ts 对着真实内核核对） */
describe('案例库数据', () => {
  it('有案例，id 唯一且只用安全字符（草稿键按它隔离）', () => {
    expect(QIU_CASES.length).toBeGreaterThan(0)
    const ids = QIU_CASES.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it('只认登记过的案例库', () => {
    expect(findLibrary('qiu-circuits')).toBe(CASE_LIBRARIES['qiu-circuits'])
    expect(findLibrary('toString')).toBeUndefined()
    expect(findLibrary('nope')).toBeUndefined()
  })

  it.each(QIU_CASES.map((item) => [item.id, item] as const))('%s：说明齐全', (_, item) => {
    expect(item.title.trim()).not.toBe('')
    expect(item.summary.trim()).not.toBe('')
    expect(item.tryIt.length).toBeGreaterThan(0)
    expect(item.checks.length).toBeGreaterThan(0)
    expect(item.source).toMatch(/^例 \d+-\d+/)
    expect(item.chapter).toBe(Number(item.source.match(/\d+/)?.[0]))
  })

  it.each(QIU_CASES.map((item) => [item.id, item] as const))('%s：元件参数名都是定义里有的，读出来的值与原值一致', (_, item) => {
    for (const node of item.circuit.nodes) {
      const definition = circuitComponentLibrary[node.type as keyof typeof circuitComponentLibrary]
      expect(definition, `${node.id} 的类型 ${node.type}`).toBeDefined()
      const keys = definition.parameters.map((parameter) => parameter.key)
      for (const key of Object.keys(node.data.parameters)) expect(keys, `${node.id}.${key}`).toContain(key)
    }
    const { nodes } = caseCircuit(item)
    for (const raw of item.circuit.nodes) {
      const loaded = nodes.find((node) => node.id === raw.id)
      for (const [key, value] of Object.entries(raw.data.parameters)) expect(loaded?.data.parameters[key]).toBe(value)
    }
  })

  it.each(QIU_CASES.map((item) => [item.id, item] as const))('%s：按预设能构造请求，核对点和端口都找得到', (_, item) => {
    const build = casePayload(item)
    expect(build.errors).toEqual([])
    expect(build.payload?.method).toBe(item.preset.method)
    for (const check of item.checks) expect(resolveCheckPath(check.path, build.payload!), check.path).toBeDefined()
    if (item.preset.method === 'thevenin') expect(resolveTheveninPort(item.preset, build.payload!)).toBeDefined()
  })
})
