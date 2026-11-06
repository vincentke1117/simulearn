import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runSimulationRequest } from '@/simulation/api'
import { buildSimulationPayload } from '@/simulation/payload'
import type { CircuitNodeData, NodeVoltageResult, SimulationPayload, SimulationResponse } from '@/types/circuit'
import { initialSimulationSettings } from '@/workspace/circuitWorkspaceHelpers'
import { useWorkspaceSimulation } from '@/workspace/useWorkspaceSimulation'

vi.mock('@/simulation/api', () => ({ runSimulationRequest: vi.fn(), beginSimulationRun: vi.fn(), cancelSimulation: vi.fn() }))
vi.mock('@/simulation/payload', () => ({ buildSimulationPayload: vi.fn(), buildNets: vi.fn(() => ({ nets: [], handleNetMap: new Map(), errors: [] })) }))

const runMock = vi.mocked(runSimulationRequest)
const buildMock = vi.mocked(buildSimulationPayload)

function createNode(id: string, type: string, parameters: Record<string, number> = {}): Node<CircuitNodeData> {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id, type: type as CircuitNodeData['type'], parameters },
  }
}

const payload: SimulationPayload = {
  components: [],
  nets: [],
  sim: { t_stop: 1e-3, n_samples: 10 },
  method: 'transient',
}

const okData: NodeVoltageResult = { node_voltages: { N1: 5 }, branch_currents: { R1: 0.005 } }
const okResponse: SimulationResponse = { status: 'ok', message: 'ok', data: okData }
const backendError: SimulationResponse = {
  status: 'error',
  message: '仿真求解失败',
  code: 'LAB_SIM_FAILED',
  data: { method: 'transient' },
}

function setup(initialNodes: Node<CircuitNodeData>[]) {
  let currentNodes = initialNodes
  const edges: Edge[] = []
  const reactFlow = {
    getNodes: () => currentNodes,
    getEdges: () => edges,
  } as unknown as ReactFlowInstance<Node<CircuitNodeData>, Edge>
  const hook = renderHook(
    ({ nodes }) => useWorkspaceSimulation({
      nodes,
      edges,
      diagramMode: 'electrical',
      reactFlow,
      setNodes: vi.fn(),
      setWorkspaceMessage: vi.fn(),
    }),
    { initialProps: { nodes: initialNodes } },
  )
  const setNodes = (nodes: Node<CircuitNodeData>[]) => {
    currentNodes = nodes
    hook.rerender({ nodes })
  }
  return { ...hook, setNodes }
}

const resistiveCircuit = [createNode('R1', 'resistor', { value: 1000 }), createNode('G1', 'ground')]

describe('useWorkspaceSimulation error visibility', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    buildMock.mockReturnValue({ ok: true, errors: [], payload })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('reopens a closed result panel when the backend returns an error envelope, keeping message + code', async () => {
    const { result } = setup(resistiveCircuit)

    runMock.mockResolvedValueOnce(okResponse)
    await act(() => result.current.handleRunSimulation())
    expect(result.current.showResultPanel).toBe(true)

    act(() => result.current.setShowResultPanel(false))
    expect(result.current.showResultPanel).toBe(false)

    runMock.mockResolvedValueOnce(backendError)
    await act(() => result.current.handleRunSimulation())

    expect(result.current.showResultPanel).toBe(true)
    expect(result.current.simulationResult).toBeNull()
    expect(result.current.simulationError).toEqual({
      message: '仿真求解失败',
      code: 'LAB_SIM_FAILED',
      data: { method: 'transient' },
    })
  })

  it('opens the panel for payload build errors and thrown request failures', async () => {
    const { result } = setup(resistiveCircuit)

    buildMock.mockReturnValueOnce({ ok: false, errors: ['检测到断路元件：R1', '存在悬空端子'] })
    await act(() => result.current.handleRunSimulation())
    expect(result.current.showResultPanel).toBe(true)
    expect(result.current.simulationError).toEqual({ message: '检测到断路元件：R1；存在悬空端子' })
    expect(runMock).not.toHaveBeenCalled()

    act(() => result.current.setShowResultPanel(false))
    runMock.mockRejectedValueOnce(new Error('无法连接后端服务'))
    await act(() => result.current.handleRunSimulation())
    expect(result.current.showResultPanel).toBe(true)
    expect(result.current.simulationError).toEqual({ message: '无法连接后端服务' })
  })

  it('opens the panel when switch scenarios fail, and surfaces the current combination\'s own error', async () => {
    const closed = [...resistiveCircuit, createNode('S1', 'switch', { state: 0 })]
    const opened = [...resistiveCircuit, createNode('S1', 'switch', { state: 1 })]
    const { result, setNodes } = setup(closed)

    // 两种组合全失败 → 取第一个错误
    runMock.mockResolvedValueOnce(backendError).mockResolvedValueOnce({ status: 'error', message: '其他错误' })
    await act(() => result.current.handleRunSimulation())
    expect(result.current.showResultPanel).toBe(true)
    expect(result.current.simulationError).toEqual(expect.objectContaining({ code: 'LAB_SIM_FAILED' }))

    // 当前组合（S1:0）失败、另一组合成功 → 仍要显示当前组合的错误
    act(() => result.current.setShowResultPanel(false))
    const currentComboError: SimulationResponse = { status: 'error', message: '当前组合不收敛', code: 'LAB_SIM_DIVERGED' }
    runMock.mockResolvedValueOnce(currentComboError).mockResolvedValueOnce(okResponse)
    await act(() => result.current.handleRunSimulation())
    expect(result.current.showResultPanel).toBe(true)
    expect(result.current.simulationError).toEqual({ message: '当前组合不收敛', code: 'LAB_SIM_DIVERGED', data: undefined })

    // 切到有缓存结果的组合：旧错误清掉，显示该组合的结果
    act(() => setNodes(opened))
    expect(result.current.simulationError).toBeNull()
    expect(result.current.simulationResult).toEqual(okData)
  })
})

describe('useWorkspaceSimulation keeps old results off a changed circuit', () => {
  beforeEach(() => buildMock.mockReturnValue({ ok: true, errors: [], payload }))
  afterEach(() => vi.clearAllMocks())

  it('drops a response that comes back after the circuit was replaced (restore initial / import)', async () => {
    const { result } = setup(resistiveCircuit)
    let respond: (value: SimulationResponse) => void = () => {}
    runMock.mockReturnValueOnce(new Promise((resolve) => { respond = resolve }))

    let running: Promise<void> = Promise.resolve()
    act(() => { running = result.current.handleRunSimulation() })
    act(() => result.current.resetSimulation())
    await act(async () => {
      respond(okResponse)
      await running
    })

    expect(result.current.simulationResult).toBeNull()
    expect(result.current.isSimulating).toBe(false)
  })

  it('marks the result stale and drops the switch cache when a parameter changes', async () => {
    const closed = [...resistiveCircuit, createNode('S1', 'switch', { state: 0 })]
    const { result, setNodes } = setup(closed)
    runMock.mockResolvedValueOnce(okResponse).mockResolvedValueOnce(okResponse)
    await act(() => result.current.handleRunSimulation())
    expect(result.current.resultStale).toBe(false)

    // 改了 R1 的阻值：面板数字还在，但标成过期；再切开关不能从缓存里套回改动前算的结果
    const edited = closed.map((node) => node.id === 'R1' ? createNode('R1', 'resistor', { value: 2200 }) : node)
    act(() => setNodes(edited))
    expect(result.current.resultStale).toBe(true)
    const before = result.current.simulationResult
    act(() => setNodes(edited.map((node) => node.id === 'S1' ? createNode('S1', 'switch', { state: 1 }) : node)))
    expect(result.current.simulationResult).toBe(before)

    // 只拨开关不算改参数
    runMock.mockResolvedValueOnce(okResponse).mockResolvedValueOnce(okResponse)
    await act(() => result.current.handleRunSimulation())
    expect(result.current.resultStale).toBe(false)
    act(() => setNodes(edited))
    expect(result.current.resultStale).toBe(false)
  })
})

describe('useWorkspaceSimulation parameter change while a request is in flight', () => {
  beforeEach(() => buildMock.mockReturnValue({ ok: true, errors: [], payload }))
  afterEach(() => vi.clearAllMocks())

  it('keeps the late result in the panel (marked stale) but does not paint it onto the edited canvas', async () => {
    let currentNodes = resistiveCircuit
    const setNodesSpy = vi.fn()
    const reactFlow = { getNodes: () => currentNodes, getEdges: () => [] } as unknown as ReactFlowInstance<Node<CircuitNodeData>, Edge>
    const { result, rerender } = renderHook(
      ({ nodes }) => useWorkspaceSimulation({
        nodes, edges: [], diagramMode: 'electrical', reactFlow, setNodes: setNodesSpy, setWorkspaceMessage: vi.fn(),
      }),
      { initialProps: { nodes: resistiveCircuit } },
    )
    let respond: (value: SimulationResponse) => void = () => {}
    runMock.mockReturnValueOnce(new Promise((resolve) => { respond = resolve }))
    let running: Promise<void> = Promise.resolve()
    act(() => { running = result.current.handleRunSimulation() })

    // 请求还在路上，学生改了 R1
    currentNodes = resistiveCircuit.map((node) => node.id === 'R1' ? createNode('R1', 'resistor', { value: 2200 }) : node)
    act(() => rerender({ nodes: currentNodes }))
    const callsBeforeResponse = setNodesSpy.mock.calls.length
    await act(async () => {
      respond(okResponse)
      await running
    })

    expect(result.current.simulationResult).toBe(okData)
    expect(result.current.resultStale).toBe(true)
    expect(setNodesSpy.mock.calls.length).toBe(callsBeforeResponse)
  })
})

describe('useWorkspaceSimulation case presets', () => {
  it('starts from the case preset (method, sweep, Thevenin port) instead of the editor defaults', () => {
    const settings = { ...initialSimulationSettings, method: 'thevenin' as const, tStop: 2e-3 }
    const port = { positiveNode: 'n2', negativeNode: 'gnd' }
    const reactFlow = { getNodes: () => [], getEdges: () => [] } as unknown as ReactFlowInstance<Node<CircuitNodeData>, Edge>
    const { result } = renderHook(() => useWorkspaceSimulation({
      nodes: [],
      edges: [],
      diagramMode: 'electrical',
      reactFlow,
      setNodes: vi.fn(),
      setWorkspaceMessage: vi.fn(),
      initialSettings: settings,
      initialTheveninPort: port,
    }))
    expect(result.current.simulationSettings).toBe(settings)
    expect(result.current.theveninPort).toBe(port)
  })
})

describe('useWorkspaceSimulation switch cache and staleness (round 3)', () => {
  beforeEach(() => buildMock.mockReturnValue({ ok: true, errors: [], payload }))
  afterEach(() => vi.clearAllMocks())

  it('with more than 4 switches there is no combination cache, so toggling a switch marks the result stale', async () => {
    const switches = ['S1', 'S2', 'S3', 'S4', 'S5'].map((id) => createNode(id, 'switch', { state: 0 }))
    const circuit = [...resistiveCircuit, ...switches]
    const { result, setNodes } = setup(circuit)
    runMock.mockResolvedValueOnce(okResponse)
    await act(() => result.current.handleRunSimulation())
    expect(runMock).toHaveBeenCalledTimes(1)
    expect(result.current.resultStale).toBe(false)
    act(() => setNodes(circuit.map((node) => node.id === 'S1' ? createNode('S1', 'switch', { state: 1 }) : node)))
    expect(result.current.resultStale).toBe(true)
  })

  it('changing a result-affecting setting (tStop) marks the result stale and drops the switch cache', async () => {
    const closed = [...resistiveCircuit, createNode('S1', 'switch', { state: 0 })]
    const { result, setNodes } = setup(closed)
    runMock.mockResolvedValueOnce(okResponse).mockResolvedValueOnce({ ...okResponse, data: { node_voltages: { N1: 2 }, branch_currents: {} } })
    await act(() => result.current.handleRunSimulation())
    const before = result.current.simulationResult
    act(() => result.current.handleSimulationSettingsChange({ ...result.current.simulationSettings, tStop: 5e-3 }))
    expect(result.current.resultStale).toBe(true)
    // 缓存已作废：再拨开关不能把旧设置下算出的另一组结果套上来
    act(() => setNodes(closed.map((node) => node.id === 'S1' ? createNode('S1', 'switch', { state: 1 }) : node)))
    expect(result.current.simulationResult).toBe(before)
  })

  it('display-only settings (show branch currents) do not invalidate the result', async () => {
    const { result } = setup(resistiveCircuit)
    runMock.mockResolvedValueOnce(okResponse)
    await act(() => result.current.handleRunSimulation())
    act(() => result.current.handleSimulationSettingsChange({ ...result.current.simulationSettings, showBranchCurrents: true }))
    expect(result.current.resultStale).toBe(false)
  })

  it('toggling onto a combination that failed at run time surfaces that combination\'s own error', async () => {
    const closed = [...resistiveCircuit, createNode('S1', 'switch', { state: 0 })]
    const { result, setNodes } = setup(closed)
    runMock.mockResolvedValueOnce(okResponse).mockResolvedValueOnce(backendError)
    await act(() => result.current.handleRunSimulation())
    expect(result.current.simulationResult).toBe(okData)
    act(() => setNodes(closed.map((node) => node.id === 'S1' ? createNode('S1', 'switch', { state: 1 }) : node)))
    expect(result.current.simulationResult).toBeNull()
    expect(result.current.simulationError?.code).toBe('LAB_SIM_FAILED')
  })

  it('resetSimulation forgets the Thevenin port of the previous circuit', () => {
    const { result } = setup(resistiveCircuit)
    act(() => result.current.setTheveninPort({ positiveNode: 'n7', negativeNode: 'gnd' }))
    act(() => result.current.resetSimulation())
    expect(result.current.theveninPort).toBeUndefined()
  })
})
