import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureSimulationApi } from '@/simulation/apiBase'
import { CircuitWorkspace } from '@/workspace/CircuitWorkspace'
import { wrapProject } from '@/workspace/project'
import { resolveCircuit, writeDraft } from './circuit'
import EmbedPage from './EmbedPage'
import { openKernelStore } from './kernelStore'
import { circuitSignature, experimentKeyPrefix, projectFingerprint, type LoadMessage } from './protocol'
import { openExperimentStore, resetPageStorage } from './storage'

// 嵌入时草稿交给内核（kernelStore.ts）之后，页面这一侧要守住的两件事：
// 页面被卸掉时最后半秒的修改也要发出去、而且整次卸载只发一个 keepalive；预读回来之前不渲染工作区。
// 这里挂的是真的工作区和 EmbedPage，只把内核换成假的 fetch。

const PREFIX = experimentKeyPrefix('lab-1')
const DRAFT_KEY = `${PREFIX}draft-v1`

const divider = {
  nodes: [
    { id: 'V1', type: 'vsource_dc', position: { x: 0, y: 0 }, data: { label: 'V1', type: 'vsource_dc', parameters: { dc: 5 } } },
    { id: 'R1', type: 'resistor', position: { x: 100, y: 0 }, data: { label: 'R1', type: 'resistor', parameters: { value: 1000 } } },
  ],
  edges: [{ id: 'e1', source: 'V1', target: 'R1', sourceHandle: 'pos', targetHandle: 'p' }],
}

const okResponse = (data: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve({ status: 'ok', message: '', data }) }) as Response

/** 假内核：预读回 initial，POST 的每一批连同是否 keepalive 记下来 */
function fakeKernel(initial: Record<string, string> = {}) {
  const posts: { entries: Record<string, string | null>; keepalive: boolean }[] = []
  const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') return Promise.resolve(okResponse({ entries: initial }))
    const body = JSON.parse(String(init.body)) as { entries: Record<string, string | null> }
    posts.push({ entries: body.entries, keepalive: Boolean(init.keepalive) })
    return Promise.resolve(okResponse({}))
  })
  const open = (endpoint: string, prefix: string) => openKernelStore(endpoint, prefix, { fetcher: fetcher as typeof fetch })
  return { posts, open }
}

/** 发出去的草稿里 R1 的阻值 */
function draftR1(value: string | null | undefined): unknown {
  const draft = JSON.parse(value ?? 'null') as { project: { nodes: { id: string; data: { parameters: { value?: number } } }[] } }
  return draft.project.nodes.find((node) => node.id === 'R1')?.data.parameters.value
}

beforeAll(() => {
  // React Flow 要量画布尺寸，jsdom 没有 ResizeObserver
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  })
})

afterAll(() => vi.unstubAllGlobals())

beforeEach(() => localStorage.clear())

afterEach(async () => {
  cleanup()   // 先卸工作区（卸载时会落一次草稿），再关镜像、清 localStorage
  vi.useRealTimers()
  await resetPageStorage()
  localStorage.clear()
  configureSimulationApi({ storagePrefix: 'slp:lab:', embedded: false })
})

describe('嵌入工作区：页面被卸掉时把最后的修改交给内核', () => {
  /**
   * 复现最容易丢的时序：第一次修改已经写进镜像、还在镜像的防抖里；第二次修改还在工作区的防抖里，
   * 这时宿主移除 iframe。要求两份都不丢、只发一个 keepalive，发的是第二次的值
   */
  async function editTwiceThenHide(hide: () => void) {
    const kernel = fakeKernel()
    await openExperimentStore(PREFIX, kernel.open)   // 和线上一样：镜像先开、它的监听先注册
    const circuit = await resolveCircuit({ experiment: 'lab-1', project: wrapProject('circuit', 'x', divider), task: null })
    const { container } = render(<CircuitWorkspace embed={{ storagePrefix: PREFIX, fingerprint: 'f1', initial: circuit }} />)

    const r1 = container.querySelector('.react-flow__node[data-id="R1"]')
    expect(r1).not.toBeNull()
    fireEvent.click(r1 as Element)
    const resistance = screen.getByDisplayValue('1000')

    vi.useFakeTimers()
    fireEvent.change(resistance, { target: { value: '2200' } })
    await vi.advanceTimersByTimeAsync(500)   // 草稿防抖到点：2200 写进镜像，镜像自己的 250 ms 防抖还没到
    expect(kernel.posts).toHaveLength(0)
    fireEvent.change(resistance, { target: { value: '3300' } })   // 这一次还在工作区的防抖里

    hide()
    expect(kernel.posts).toHaveLength(1)
    expect(kernel.posts[0].keepalive).toBe(true)
    expect(draftR1(kernel.posts[0].entries[DRAFT_KEY])).toBe(3300)

    // 两边的防抖都过去之后也不再补发：同一个键只有这一个请求，不会有旧值后到、盖掉新值
    await vi.advanceTimersByTimeAsync(2000)
    expect(kernel.posts).toHaveLength(1)
  }

  it('pagehide：只发一个 keepalive，内容是最后一次修改', async () => {
    await editTwiceThenHide(() => window.dispatchEvent(new Event('pagehide')))
  })

  it('visibilitychange 到 hidden：同上', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    try {
      await editTwiceThenHide(() => document.dispatchEvent(new Event('visibilitychange')))
    } finally {
      visibility.mockRestore()
    }
  })
})

describe('EmbedPage：预读回来之前不渲染工作区', () => {
  it('先显示「正在读取」；内核回了存着的草稿，工作区才出来，并且恢复这份草稿', async () => {
    const load: LoadMessage = { experiment: 'lab-1', project: wrapProject('circuit', 'x', divider), task: null }
    const circuit = await resolveCircuit(load)
    // 指纹按 EmbedPage 的算法算：课程给的引用 + 解析出来的电路
    const fingerprint = projectFingerprint({ project: load.project, circuit: circuitSignature(circuit.nodes, circuit.edges) })
    const changed = circuit.nodes.map((node) =>
      node.id === 'R1' ? { ...node, data: { ...node.data, parameters: { value: 4700 } } } : node)
    // 先借 localStorage 造一份「上次」的草稿交给假内核；客户端重开后页面换了端口，localStorage 是空的
    writeDraft(PREFIX, fingerprint, circuitSignature(circuit.nodes, circuit.edges), changed, circuit.edges)
    const saved = localStorage.getItem(DRAFT_KEY)
    expect(saved).not.toBeNull()
    localStorage.clear()

    let releasePreload: (() => void) | null = null
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(okResponse({}))
      return new Promise<Response>((resolve) => {
        releasePreload = () => resolve(okResponse({ entries: { [DRAFT_KEY]: saved } }))
      })
    })

    try {
      const { container } = render(<MemoryRouter><EmbedPage /></MemoryRouter>)
      expect(screen.getByText('正在等待课堂发来实验电路…')).toBeInTheDocument()

      // 宿主发 load。jsdom 里顶层窗口的 parent 就是它自己，startEmbed 只认 source 为 parent 的消息
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { source: 'zhifan-host', type: 'load', ...load }, source: window }))
      })
      expect(await screen.findByText('正在读取实验电路和你上次的进度…')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith(`../api/lab/store?prefix=${encodeURIComponent(PREFIX)}`, undefined)
      // 电路早就解析完了，但预读没回来：不能先挂工作区（那样会先读到空草稿、显示初始电路）
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(container.querySelector('.react-flow')).toBeNull()
      expect(screen.getByText('正在读取实验电路和你上次的进度…')).toBeInTheDocument()

      expect(releasePreload).not.toBeNull()
      await act(async () => releasePreload?.())
      expect(await screen.findByText(/已恢复你上次的修改/)).toBeInTheDocument()
      const r1 = container.querySelector('.react-flow__node[data-id="R1"]')
      expect(r1).not.toBeNull()
      fireEvent.click(r1 as Element)
      expect(screen.getByDisplayValue('4700')).toBeInTheDocument()
    } finally {
      cleanup()   // 卸载时那次落盘也要走假 fetch
      await resetPageStorage()
      fetchMock.mockRestore()
    }
  })
})
