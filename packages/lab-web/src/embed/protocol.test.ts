import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'

import type { CircuitNodeData } from '@/types/circuit'
import {
  CONTRACT,
  circuitSignature,
  experimentKeyPrefix,
  parseLoadMessage,
  projectFingerprint,
  resolveProject,
  startEmbed,
  type EmbedWindow,
  type LoadMessage,
} from './protocol'

const resistor = (id: string, value: number, x = 0): Node<CircuitNodeData> => ({
  id,
  type: 'resistor',
  position: { x, y: 0 },
  data: { label: id, type: 'resistor', parameters: { value } },
})

describe('parseLoadMessage', () => {
  it('accepts the host load message and defaults missing project / task to null', () => {
    expect(parseLoadMessage({ source: 'zhifan-host', type: 'load', experiment: 'lab-1' }))
      .toEqual({ experiment: 'lab-1', project: null, task: null })
  })

  it('ignores anything that is not a load from the host', () => {
    for (const data of [null, 'load', { source: 'zhifan-ext', type: 'load', experiment: 'x' },
      { source: 'zhifan-host', type: 'ready', experiment: 'x' }, { source: 'zhifan-host', type: 'load', experiment: '' }]) {
      expect(parseLoadMessage(data)).toBeNull()
    }
  })
})

describe('resolveProject', () => {
  it('reads {"example": id} and passes envelopes through', () => {
    expect(resolveProject({ example: 'voltage-divider' })).toEqual({ kind: 'example', id: 'voltage-divider' })
    const envelope = { schema: 'simulearn.project/1', kind: 'circuit', payload: { nodes: [] } }
    expect(resolveProject(envelope)).toEqual({ kind: 'project', project: envelope })
  })

  it('rejects a missing project and unsafe example names', () => {
    expect(resolveProject(null).kind).toBe('error')
    expect(resolveProject({ example: '../x' }).kind).toBe('error')
    expect(resolveProject({ example: 3 }).kind).toBe('error')
  })

  it('reads {"library": id} as the case library, with the same name rules', () => {
    expect(resolveProject({ library: 'qiu-circuits' })).toEqual({ kind: 'library', id: 'qiu-circuits' })
    expect(resolveProject({ library: '../x' }).kind).toBe('error')
    expect(resolveProject({ library: null }).kind).toBe('error')
  })
})

describe('storage isolation', () => {
  it('namespaces keys per experiment and strips unsafe characters', () => {
    expect(experimentKeyPrefix('ch01-ohm')).toBe('slp:lab:exp:ch01-ohm:')
    expect(experimentKeyPrefix('a:b/c')).toBe('slp:lab:exp:a_b_c:')
    expect(experimentKeyPrefix('')).toBe('slp:lab:exp:_:')
  })

  it('fingerprints change when the course project changes', () => {
    expect(projectFingerprint({ example: 'a' })).toBe(projectFingerprint({ example: 'a' }))
    expect(projectFingerprint({ example: 'a' })).not.toBe(projectFingerprint({ example: 'b' }))
  })
})

describe('circuitSignature', () => {
  const edges: Edge[] = [{ id: 'e1', source: 'R1', target: 'R2', sourceHandle: 'n', targetHandle: 'p' }]

  it('ignores positions and node order', () => {
    expect(circuitSignature([resistor('R1', 1), resistor('R2', 2)], edges))
      .toBe(circuitSignature([resistor('R2', 2, 300), resistor('R1', 1, 120)], edges))
  })

  it('changes when a parameter or a connection changes', () => {
    const base = circuitSignature([resistor('R1', 1), resistor('R2', 2)], edges)
    expect(circuitSignature([resistor('R1', 5), resistor('R2', 2)], edges)).not.toBe(base)
    expect(circuitSignature([resistor('R1', 1), resistor('R2', 2)], [{ ...edges[0], targetHandle: 'n' }])).not.toBe(base)
  })
})

describe('startEmbed', () => {
  function fakeWindow() {
    const parent = { postMessage: vi.fn() }
    let listener: ((event: MessageEvent) => void) | undefined
    const win: EmbedWindow = {
      parent,
      addEventListener: (_type, l) => { listener = l },
      removeEventListener: () => { listener = undefined },
    }
    const send = (data: unknown, source: unknown = parent) => listener?.({ data, source } as MessageEvent)
    return { win, parent, send, hasListener: () => listener !== undefined }
  }

  it('posts ready with the contract to "*" and applies the load from the parent only', async () => {
    const { win, parent, send } = fakeWindow()
    const applyExperiment = vi.fn()
    startEmbed(win, { resolve: async (load: LoadMessage) => load.project, applyExperiment, onError: vi.fn() })
    expect(parent.postMessage).toHaveBeenCalledWith({ source: 'zhifan-ext', type: 'ready', contract: CONTRACT }, '*')

    send({ source: 'zhifan-host', type: 'load', experiment: 'x', project: { example: 'a' } }, {})
    send({ source: 'zhifan-host', type: 'load', experiment: 'lab-1', project: { example: 'a' } })
    await vi.waitFor(() => expect(applyExperiment).toHaveBeenCalledTimes(1))
    expect(applyExperiment.mock.calls[0][0].experiment).toBe('lab-1')
  })

  it('reports resolve failures to the page and to the host', async () => {
    const { win, parent, send } = fakeWindow()
    const onError = vi.fn()
    startEmbed(win, { resolve: async () => { throw new Error('读不出来') }, applyExperiment: vi.fn(), onError })
    send({ source: 'zhifan-host', type: 'load', experiment: 'lab-1', project: {} })
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('读不出来'))
    expect(parent.postMessage).toHaveBeenLastCalledWith({ source: 'zhifan-ext', type: 'error', message: '读不出来' }, '*')
  })

  it('sends nothing when not inside a frame, and stops listening when disposed', () => {
    const listeners: Array<(event: MessageEvent) => void> = []
    const win = {
      addEventListener: (_type: 'message', l: (event: MessageEvent) => void) => { listeners.push(l) },
      removeEventListener: () => { listeners.pop() },
    } as unknown as EmbedWindow & { parent: EmbedWindow['parent'] }
    const postMessage = vi.fn()
    ;(win as { parent: unknown }).parent = win
    ;(win as unknown as { postMessage: typeof postMessage }).postMessage = postMessage
    const stop = startEmbed(win, { resolve: async () => null, applyExperiment: vi.fn(), onError: vi.fn() })
    expect(postMessage).not.toHaveBeenCalled()
    stop()
    expect(listeners).toHaveLength(0)
  })
})
