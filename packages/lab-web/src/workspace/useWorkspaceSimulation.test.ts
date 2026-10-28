import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runSimulationRequest } from '@/simulation/api'
import { buildSimulationPayload } from '@/simulation/payload'
import type { CircuitNodeData, NodeVoltageResult, SimulationPayload, SimulationResponse } from '@/types/circuit'
import { useWorkspaceSimulation } from '@/workspace/useWorkspaceSimulation'

vi.mock('@/simulation/api', () => ({ runSimulationRequest: vi.fn() }))
vi.mock('@/simulation/payload', () => ({ buildSimulationPayload: vi.fn() }))

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
