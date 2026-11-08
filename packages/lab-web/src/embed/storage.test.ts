import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { wrapProject } from '@/workspace/project'
import { hasDraft, readDraft, resolveCircuit, writeDraft } from './circuit'
import { openKernelStore } from './kernelStore'
import { circuitSignature } from './protocol'
import { flushPageStorage, openExperimentStore, pageStorage, resetPageStorage } from './storage'

const PREFIX = 'slp:lab:exp:lab-1:'

const divider = {
  nodes: [
    { id: 'V1', type: 'vsource_dc', position: { x: 0, y: 0 }, data: { label: 'V1', type: 'vsource_dc', parameters: { dc: 5 } } },
    { id: 'R1', type: 'resistor', position: { x: 100, y: 0 }, data: { label: 'R1', type: 'resistor', parameters: { value: 1000 } } },
  ],
  edges: [{ id: 'e1', source: 'V1', target: 'R1', sourceHandle: 'pos', targetHandle: 'p' }],
}

/** 假内核：预读回 initial，POST 的每一批记下来 */
function fakeKernel(initial: Record<string, string> = {}) {
  const posts: Record<string, string | null>[] = []
  const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') posts.push((JSON.parse(String(init.body)) as { entries: Record<string, string | null> }).entries)
    const data = init?.method === 'POST' ? {} : { entries: initial }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'ok', message: '', data }) } as Response)
  })
  const open = (endpoint: string, prefix: string) => openKernelStore(endpoint, prefix, { fetcher: fetcher as typeof fetch })
  return { fetcher, posts, open }
}

beforeEach(() => localStorage.clear())
afterEach(async () => {
  await resetPageStorage()
  localStorage.clear()
})

describe('pageStorage', () => {
  it('没打开内核镜像时（开发态独立页面、测试）照旧是 localStorage', () => {
    pageStorage.setItem(`${PREFIX}x`, '1')
    expect(localStorage.getItem(`${PREFIX}x`)).toBe('1')
    expect(pageStorage.getItem(`${PREFIX}x`)).toBe('1')
    pageStorage.removeItem(`${PREFIX}x`)
    expect(localStorage.getItem(`${PREFIX}x`)).toBeNull()
    expect(() => flushPageStorage()).not.toThrow()
  })

  it('打开镜像后按键前缀落到对应实验的镜像里，不碰 localStorage；同一实验只开一次', async () => {
    const kernel = fakeKernel({ [`${PREFIX}last-case`]: 'case-1-1' })
    const store = await openExperimentStore(PREFIX, kernel.open)
    expect(await openExperimentStore(PREFIX, kernel.open)).toBe(store)   // 宿主重发 load：不重新预读
    expect(kernel.fetcher).toHaveBeenCalledTimes(1)
    expect(kernel.fetcher.mock.calls[0][0]).toBe(`../api/lab/store?prefix=${encodeURIComponent(PREFIX)}`)

    expect(pageStorage.getItem(`${PREFIX}last-case`)).toBe('case-1-1')
    pageStorage.setItem(`${PREFIX}case-a:draft-v1`, 'd')
    expect(localStorage.length).toBe(0)
    expect(() => pageStorage.setItem('slp:lab:exp:other:x', '1')).toThrow('不属于已打开的实验')

    flushPageStorage()
    await vi.waitFor(() => expect(kernel.posts).toEqual([{ [`${PREFIX}case-a:draft-v1`]: 'd' }]))
  })

  it('换实验后，旧实验的键仍落回旧实验自己的镜像', async () => {
    const kernel = fakeKernel()
    await openExperimentStore(PREFIX, kernel.open)
    await openExperimentStore('slp:lab:exp:lab-2:', kernel.open)
    pageStorage.setItem(`${PREFIX}draft-v1`, 'old')
    pageStorage.setItem('slp:lab:exp:lab-2:draft-v1', 'new')
    flushPageStorage()
    await vi.waitFor(() => expect(kernel.posts).toHaveLength(2))
    expect(kernel.posts).toEqual(expect.arrayContaining([
      { [`${PREFIX}draft-v1`]: 'old' },
      { 'slp:lab:exp:lab-2:draft-v1': 'new' },
    ]))
  })
})

describe('嵌入草稿存进内核镜像', () => {
  it('readDraft / writeDraft / hasDraft 走镜像：预读到的草稿直接恢复，新草稿发给内核', async () => {
    const circuit = await resolveCircuit({ experiment: 'lab-1', project: wrapProject('circuit', 'x', divider), task: null })
    const baseline = circuitSignature(circuit.nodes, circuit.edges)
    const changed = circuit.nodes.map((node) =>
      node.id === 'R1' ? { ...node, data: { ...node.data, parameters: { value: 2200 } } } : node)

    // 先用 localStorage 造一份「上次」的草稿，再原样交给假内核预读：客户端重开后页面换了端口，localStorage 是空的
    writeDraft(PREFIX, 'f1', baseline, changed, circuit.edges)
    const saved = localStorage.getItem(`${PREFIX}draft-v1`)
    expect(saved).not.toBeNull()
    localStorage.clear()

    const kernel = fakeKernel({ [`${PREFIX}draft-v1`]: saved ?? '' })
    await openExperimentStore(PREFIX, kernel.open)
    expect(hasDraft(PREFIX, 'f1')).toBe(true)
    expect(readDraft(PREFIX, 'f1')?.nodes.find((node) => node.id === 'R1')?.data.parameters.value).toBe(2200)

    // 改回原样：草稿删掉，发给内核的是 null
    writeDraft(PREFIX, 'f1', baseline, circuit.nodes, circuit.edges)
    expect(readDraft(PREFIX, 'f1')).toBeNull()
    flushPageStorage()
    await vi.waitFor(() => expect(kernel.posts).toEqual([{ [`${PREFIX}draft-v1`]: null }]))
    expect(localStorage.length).toBe(0)
  })
})
