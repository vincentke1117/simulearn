import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SimulationPayload } from '@/types/circuit'
import { beginSimulationRun, runSimulationRequest } from './api'
import { configureSimulationApi } from './apiBase'

const payload: SimulationPayload = { components: [], nets: [], sim: { t_stop: 1e-3, n_samples: 10 }, method: 'node_voltage' }
const ok = { status: 'ok', message: 'ok', data: { node_voltages: { n1: 1 }, branch_currents: {} } }

/** 一直不返回、只认 abort 的 fetch：模拟内核在算一个很重的请求 */
function hangingFetch() {
  return vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError')))
  }))
}

describe('runSimulationRequest', () => {
  beforeEach(() => {
    localStorage.clear()
    beginSimulationRun()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    configureSimulationApi({ storagePrefix: 'slp:lab:', embedded: false })
  })

  it('keeps no result cache in localStorage when embedded (it could never be replayed there)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ok), { status: 200 })))
    configureSimulationApi({ storagePrefix: 'slp:lab:exp:lab-1:', embedded: true })
    await runSimulationRequest(payload)
    expect(Object.keys(localStorage)).toEqual([])

    configureSimulationApi({ storagePrefix: 'slp:lab:', embedded: false })
    await runSimulationRequest(payload)
    expect(Object.keys(localStorage).every((key) => key.startsWith('slp:lab:sim:'))).toBe(true)
  })

  it('gives up on a timeout without resending the heavy request, and says why in Chinese', async () => {
    vi.useFakeTimers()
    const fetchMock = hangingFetch()
    vi.stubGlobal('fetch', fetchMock)
    configureSimulationApi({ storagePrefix: 'slp:lab:exp:lab-1:', embedded: true })
    const request = runSimulationRequest(payload)
    const settled = expect(request).rejects.toThrow('秒没有返回')
    await vi.advanceTimersByTimeAsync(600_001)
    await settled
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lets all requests of one run share the run, so concurrent switch combinations do not cancel each other', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      await Promise.resolve()
      return new Response(JSON.stringify(ok), { status: 200 })
    }))
    const results = await Promise.all([runSimulationRequest(payload), runSimulationRequest(payload), runSimulationRequest(payload)])
    expect(results.map((response) => response.status)).toEqual(['ok', 'ok', 'ok'])
    expect(calls).toBe(3)
  })
})
