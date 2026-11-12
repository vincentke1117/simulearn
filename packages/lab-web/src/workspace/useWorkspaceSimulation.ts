import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'

import { beginSimulationRun, cancelSimulation, runSimulationRequest } from '@/simulation/api'
import { circuitSignature } from '@/embed/protocol'
import { API_BASE_URL } from '@/simulation/apiBase'
import { buildControlSimulationPayload } from '@/simulation/controlPayload'
import { detectDiagramMode } from '@/simulation/diagramMode'
import { applyOverlay } from '@/simulation/mapping'
import { buildMixedSimulationPayload } from '@/simulation/mixedPayload'
import { buildNets, buildSimulationPayload } from '@/simulation/payload'
import { describeNets } from '@/simulation/netLabels'
import type {
  AnalysisResultData,
  CircuitNodeData,
  SimulationErrorInfo,
  SimulationNetPayload,
  SimulationPayload,
  SimulationRequestPayload,
  SimulationSettings,
  TheveninPortConfig,
} from '@/types/circuit'
import type { DiagramMode } from '@/types/control'
import {
  getSwitchStateSignature,
  initialSimulationSettings,
  pickBranchCurrents,
  pickNodeVoltages,
  teachingStepsReliable,
} from './circuitWorkspaceHelpers'

export type WorkspaceMessage = { tone: 'info' | 'error'; text: string } | null

/** 画布上的电压 / 电流标注属于某一次结果；电路一变就得擦掉，不然旧数值挂在新电路上 */
function clearOverlay(nodes: Node<CircuitNodeData>[]): Node<CircuitNodeData>[] {
  if (!nodes.some((node) => node.data.voltage !== undefined || node.data.voltageDelta !== undefined || node.data.current !== undefined)) {
    return nodes
  }
  return nodes.map((node) => ({
    ...node,
    data: { ...node.data, voltage: undefined, voltageDelta: undefined, current: undefined },
  }))
}

/**
 * 决定结果是否还作数的全部输入：电气内容 + 影响结果的仿真设置。一变，缓存和画布标注就都过期了。
 * 开关通断只在上一次运行建了开关组合缓存时（electrical、1～4 个开关）才不算：那时拨开关是查缓存；
 * 开关更多、或混合仿真时没有缓存，拨开关同样让结果过期。
 * 只影响显示的设置（结点 / 元件电压、是否显示支路电流）不算在内，切换它们不该丢掉有效的缓存。
 */
function parameterSignature(
  nodes: Node<CircuitNodeData>[],
  edges: Edge[],
  maskSwitches: boolean,
  settings: SimulationSettings,
  theveninPort: TheveninPortConfig | undefined,
  teachingMode: boolean,
): string {
  const circuit = circuitSignature(
    maskSwitches
      ? nodes.map((node) => node.type === 'switch'
        ? { ...node, data: { ...node.data, parameters: { ...node.data.parameters, state: 0 } } }
        : node)
      : nodes,
    edges,
  )
  const { method, tStop, nSamples, sweep, comparisonMethods } = settings
  return JSON.stringify([
    circuit, method ?? null, tStop, nSamples, sweep ?? null, comparisonMethods ?? null,
    method === 'thevenin' ? theveninPort ?? null : null, teachingMode,
  ])
}

interface PayloadBuildResult {
  ok: boolean
  errors: string[]
  payload?: SimulationRequestPayload
}

interface UseWorkspaceSimulationOptions {
  nodes: Node<CircuitNodeData>[]
  edges: Edge[]
  diagramMode: DiagramMode
  reactFlow: ReactFlowInstance<Node<CircuitNodeData>, Edge>
  setNodes: Dispatch<SetStateAction<Node<CircuitNodeData>[]>>
  setWorkspaceMessage: (message: WorkspaceMessage) => void
  /** 案例库的预设（分析方法、仿真时长、扫频范围、戴维宁端口）；不给就用编辑器缺省值 */
  initialSettings?: SimulationSettings
  initialTheveninPort?: TheveninPortConfig
}

export interface WorkspaceSimulationState {
  simulationSettings: SimulationSettings
  /** 当前结果对应的网络（结果表行名用）；还没有结果或电路换掉后为 null */
  resultNets: SimulationNetPayload[] | null
  simulationResult: AnalysisResultData | null
  simulationError: SimulationErrorInfo | null
  isSimulating: boolean
  showResultPanel: boolean
  lastMethodUsed: string | undefined
  teachingMode: boolean
  theveninPort: TheveninPortConfig | undefined
  availableNodes: string[]
  availableNodeLabels: Record<string, string>
  setSimulationResult: Dispatch<SetStateAction<AnalysisResultData | null>>
  setSimulationError: Dispatch<SetStateAction<SimulationErrorInfo | null>>
  setShowResultPanel: Dispatch<SetStateAction<boolean>>
  setTeachingMode: Dispatch<SetStateAction<boolean>>
  setTheveninPort: Dispatch<SetStateAction<TheveninPortConfig | undefined>>
  handleSimulationSettingsChange: (settings: SimulationSettings) => void
  handleRunSimulation: () => Promise<void>
  resetSimulation: () => void
  /** 结果算完之后参数或连线又改过：面板里的数字还留着方便对比，但要标明是改动前的 */
  resultStale: boolean
}

export function useWorkspaceSimulation({
  nodes,
  edges,
  diagramMode,
  reactFlow,
  setNodes,
  setWorkspaceMessage,
  initialSettings,
  initialTheveninPort,
}: UseWorkspaceSimulationOptions): WorkspaceSimulationState {
  const [simulationSettings, setSimulationSettings] = useState(() => initialSettings ?? initialSimulationSettings)
  const [simulationResult, setSimulationResult] = useState<AnalysisResultData | null>(null)
  const [simulationResultCache, setSimulationResultCache] = useState<Record<string, AnalysisResultData> | null>(null)
  // 开关组合里算失败的那几组：拨到它们时要亮出它们自己的错误，不能继续显示上一组的结果
  const [scenarioErrors, setScenarioErrors] = useState<Record<string, SimulationErrorInfo> | null>(null)
  const [maskSwitches, setMaskSwitches] = useState(false)
  const [simulationError, setSimulationError] = useState<SimulationErrorInfo | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [showResultPanel, setShowResultPanel] = useState(false)
  const [lastMethodUsed, setLastMethodUsed] = useState<string>()
  const [teachingMode, setTeachingMode] = useState(false)
  const [theveninPort, setTheveninPort] = useState<TheveninPortConfig | undefined>(initialTheveninPort)
  const lastNetsRef = useRef<SimulationNetPayload[] | null>(null)
  const lastNodeVoltagesRef = useRef<Record<string, number> | null>(null)
  const lastBranchCurrentsRef = useRef<Record<string, number> | null>(null)
  // 每次整张电路换掉（resetSimulation）加一：还在路上的请求回来时代次对不上，结果就丢掉，不往新电路上套
  const generationRef = useRef(0)
  const [resultStale, setResultStale] = useState(false)
  // 当前结果是按哪组网络算的：结果表的行名（n1、n2… 配探针名）要按它对照，不能按改过的当前画布现算
  const [resultNets, setResultNets] = useState<SimulationNetPayload[] | null>(null)

  const updateVoltageOverlay = useCallback((
    nodeVoltages: Record<string, number>,
    nets: SimulationNetPayload[],
    displayMode: 'node' | 'element' = 'node',
    branchCurrents?: Record<string, number>,
    showBranchCurrents?: boolean,
  ) => {
    setNodes((current) => applyOverlay(
      current,
      nets,
      nodeVoltages,
      displayMode,
      branchCurrents,
      showBranchCurrents,
    ))
  }, [setNodes])

  const applyResultToOverlay = useCallback((data: AnalysisResultData, nets: SimulationNetPayload[]) => {
    try {
      const nodeVoltages = pickNodeVoltages(data)
      const branchCurrents = pickBranchCurrents(data)
      if (!nodeVoltages) {
        lastNetsRef.current = null
        lastNodeVoltagesRef.current = null
        lastBranchCurrentsRef.current = null
        return
      }

      const displayMode = simulationSettings.voltageDisplayMode ?? 'node'
      lastNetsRef.current = nets
      lastNodeVoltagesRef.current = nodeVoltages
      lastBranchCurrentsRef.current = branchCurrents
      updateVoltageOverlay(
        nodeVoltages,
        nets,
        displayMode,
        branchCurrents ?? undefined,
        simulationSettings.showBranchCurrents,
      )
    } catch (error) {
      console.warn('电压显示映射失败', error)
    }
  }, [simulationSettings.voltageDisplayMode, simulationSettings.showBranchCurrents, updateVoltageOverlay])

  // 整张电路被换掉（恢复初始电路、导入、清空）时调用：旧结果、开关组合缓存和电压叠加都属于旧电路，
  // 留着的话，按开关签名查缓存的 effect 和切换显示方式的 effect 会把旧数值自动套回新电路上
  const resetSimulation = useCallback(() => {
    generationRef.current += 1
    cancelSimulation()
    setSimulationResult(null)
    setSimulationError(null)
    setSimulationResultCache(null)
    setScenarioErrors(null)
    setResultStale(false)
    setResultNets(null)
    // 端口是上一张电路的网络名，换了电路就不作数（案例「恢复初始电路」之后会重新设上预设端口）
    setTheveninPort(undefined)
    lastNetsRef.current = null
    lastNodeVoltagesRef.current = null
    lastBranchCurrentsRef.current = null
  }, [])

  // 参数或连线变了（开关通断除外）：开关组合缓存、电压标注都作废；面板数字保留但标成过期（与 grid 10-24 的做法一致）
  const currentParameterSignature = useMemo(
    () => parameterSignature(nodes, edges, maskSwitches, simulationSettings, theveninPort, teachingMode),
    [nodes, edges, maskSwitches, simulationSettings, theveninPort, teachingMode],
  )
  const lastParameterSignature = useRef(currentParameterSignature)
  useEffect(() => {
    if (lastParameterSignature.current === currentParameterSignature) return
    lastParameterSignature.current = currentParameterSignature
    setSimulationResultCache(null)
    setScenarioErrors(null)
    lastNetsRef.current = null
    lastNodeVoltagesRef.current = null
    lastBranchCurrentsRef.current = null
    setNodes(clearOverlay)
    setResultStale(true)
  }, [currentParameterSignature, setNodes])

  // 所有失败路径的唯一出口：错误只渲染在结果面板里，面板被学生关掉后若不重新打开，失败就「什么都没发生」
  const failSimulation = useCallback((error: SimulationErrorInfo) => {
    setSimulationResult(null)
    setSimulationError(error)
    setShowResultPanel(true)
  }, [])

  const submitSingleRequest = useCallback(async (build: PayloadBuildResult, generation: number) => {
    if (!build.ok || !build.payload) {
      failSimulation({ message: build.errors.join('；') })
      return
    }
    const response = await runSimulationRequest(build.payload)
    if (generation !== generationRef.current) return
    if (response.status === 'ok') {
      setSimulationResult(response.data)
      setSimulationError(null)
      setSimulationResultCache(null)
      setLastMethodUsed('transient')
      setShowResultPanel(true)
    } else {
      failSimulation({ message: response.message, code: response.code, data: response.data })
    }
  }, [failSimulation])

  const handleRunSimulation = useCallback(async () => {
    const start = performance.now()
    const generation = generationRef.current
    const stale = () => generation !== generationRef.current
    beginSimulationRun()
    const currentNodes = reactFlow.getNodes()
    const currentEdges = reactFlow.getEdges()
    const currentDiagramMode = detectDiagramMode(currentNodes)
    const switches = currentDiagramMode === 'electrical'
      ? currentNodes.filter((node) => node.type === 'switch').sort((left, right) => left.id.localeCompare(right.id))
      : []
    const isMultiScenario = switches.length > 0 && switches.length <= 4
    // 请求在路上时学生可能又改了参数：回来的结果仍放进面板（签名 effect 已把它标成过期），
    // 但不往画布上套、不进开关组合缓存，免得改动前的数值挂在改动后的电路上
    const runSignature = parameterSignature(currentNodes, currentEdges, isMultiScenario, simulationSettings, theveninPort, teachingMode)
    // 换了遮不遮开关的方式：基准签名按新方式重算，免得紧跟着的渲染把刚开始的这次运行误判成「已改动」
    setMaskSwitches(isMultiScenario)
    lastParameterSignature.current = runSignature
    const changedSinceRun = () => lastParameterSignature.current !== runSignature

    setNodes(clearOverlay)
    setIsSimulating(true)
    setSimulationError(null)
    setSimulationResult(null)
    setSimulationResultCache(null)
    setScenarioErrors(null)
    setResultStale(false)
    setResultNets(null)

    try {
      if (currentDiagramMode === 'empty') {
        failSimulation({ message: '请先在画布中放置元件' })
        return
      }

      if (currentDiagramMode === 'mixed') {
        await submitSingleRequest(buildMixedSimulationPayload(currentNodes, currentEdges, simulationSettings), generation)
        return
      }

      if (currentDiagramMode === 'control') {
        await submitSingleRequest(buildControlSimulationPayload(currentNodes, currentEdges, simulationSettings), generation)
        return
      }

      const applyAnalysisOptions = (payload: SimulationPayload) => {
        payload.teaching_mode = teachingMode && teachingStepsReliable(payload.method)
        if (simulationSettings.method === 'thevenin' && theveninPort) {
          payload.thevenin_port = {
            positive: theveninPort.positiveNode,
            negative: theveninPort.negativeNode,
          }
        }
      }

      if (isMultiScenario) {
        const combinations = 1 << switches.length
        const promises = []
        const signatures: string[] = []

        for (let index = 0; index < combinations; index += 1) {
          const scenarioNodes = currentNodes.map((node) => {
            if (node.type !== 'switch') return node
            const switchIndex = switches.findIndex((item) => item.id === node.id)
            const state = (index >> switchIndex) & 1
            return {
              ...node,
              data: { ...node.data, parameters: { ...node.data.parameters, state } },
            }
          })
          const build = buildSimulationPayload(scenarioNodes, currentEdges, simulationSettings)
          if (!build.ok || !build.payload) throw new Error(build.errors.join('；'))
          applyAnalysisOptions(build.payload)
          signatures.push(getSwitchStateSignature(scenarioNodes))
          promises.push(runSimulationRequest(build.payload))
        }

        const results = await Promise.all(promises)
        if (stale()) return
        const newCache: Record<string, AnalysisResultData> = {}
        const errorsBySignature: Record<string, SimulationErrorInfo> = {}
        let firstError: SimulationErrorInfo | null = null
        results.forEach((response, index) => {
          if (response.status === 'ok') newCache[signatures[index]] = response.data
          else {
            const error = { message: response.message, code: response.code, data: response.data }
            errorsBySignature[signatures[index]] = error
            firstError ??= error
          }
        })

        if (Object.keys(newCache).length === 0 && firstError) {
          failSimulation(firstError)
          return
        }
        const changed = changedSinceRun()
        if (!changed) {
          setSimulationResultCache(newCache)
          setScenarioErrors(errorsBySignature)
        }
        const currentSignature = getSwitchStateSignature(currentNodes)
        const currentResult = newCache[currentSignature]
        if (currentResult) {
          setSimulationResult(currentResult)
          setShowResultPanel(true)
          const currentBuild = buildSimulationPayload(currentNodes, currentEdges, simulationSettings)
          setResultNets(currentBuild.payload?.nets ?? null)
          if (currentBuild.payload?.nets && !changed) applyResultToOverlay(currentResult, currentBuild.payload.nets)
          if (currentBuild.payload?.method) setLastMethodUsed(currentBuild.payload.method)
        } else {
          // 其他开关组合成功、唯独当前组合失败：同样要把当前组合的错误亮出来
          failSimulation(errorsBySignature[currentSignature] ?? firstError ?? { message: '当前开关组合仿真失败' })
        }
      } else {
        const build = buildSimulationPayload(currentNodes, currentEdges, simulationSettings)
        if (!build.ok || !build.payload) {
          failSimulation({ message: build.errors.join('；') })
          return
        }
        setLastMethodUsed(build.payload.method)
        applyAnalysisOptions(build.payload)
        const response = await runSimulationRequest(build.payload)
        if (stale()) return
        if (response.status === 'ok') {
          setSimulationResult(response.data)
          setSimulationError(null)
          setShowResultPanel(true)
          setResultNets(build.payload.nets ?? null)
          if (build.payload.nets && !changedSinceRun()) applyResultToOverlay(response.data, build.payload.nets)
        } else {
          failSimulation({ message: response.message, code: response.code, data: response.data })
        }
      }
    } catch (error) {
      // 电路已经整张换掉（恢复初始电路、导入）：这次运行的失败（多半是被取消）不再属于眼前的电路
      if (stale()) return
      failSimulation({ message: error instanceof Error ? error.message : '仿真请求失败' })
    } finally {
      setIsSimulating(false)
      if (!stale()) setWorkspaceMessage({ tone: 'info', text: `仿真往返时间 ${Math.round(performance.now() - start)}ms` })
    }
  }, [reactFlow, simulationSettings, setNodes, teachingMode, theveninPort, applyResultToOverlay, submitSingleRequest, failSimulation, setWorkspaceMessage])

  useEffect(() => {
    if (!simulationResultCache || detectDiagramMode(nodes) !== 'electrical') return
    const signature = getSwitchStateSignature(nodes)
    if (!signature) return
    const cachedResult = simulationResultCache[signature]
    const cachedError = scenarioErrors?.[signature]
    if (!cachedResult && cachedError && cachedError !== simulationError) {
      // 拨到运行时算失败的组合：亮出它自己的错误，画布上上一组的标注也要擦掉
      failSimulation(cachedError)
      setResultNets(null)
      setNodes(clearOverlay)
      return
    }
    if (cachedResult && cachedResult !== simulationResult) {
      setSimulationResult(cachedResult)
      // 从失败的开关组合切到有缓存结果的组合：旧错误不再适用，否则面板会继续盖住新结果
      setSimulationError(null)
      const build = buildSimulationPayload(nodes, edges, simulationSettings)
      if (build.ok && build.payload?.nets) {
        setResultNets(build.payload.nets)
        applyResultToOverlay(cachedResult, build.payload.nets)
        if (build.payload.method) setLastMethodUsed(build.payload.method)
      }
    }
  }, [nodes, edges, simulationResultCache, scenarioErrors, simulationSettings, applyResultToOverlay, simulationResult, simulationError, failSimulation, setNodes])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.shiftKey && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault()
        if (!isSimulating) void handleRunSimulation()
      }
      if (event.ctrlKey && event.shiftKey && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault()
        setShowResultPanel((current) => !current)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleRunSimulation, isSimulating])

  useEffect(() => {
    fetch(`${API_BASE_URL}/version`).then(async (response) => {
      if (!response.ok) return
      const data = await response.json().catch(() => null)
      const element = document.getElementById('server-version')
      if (element && data && data.julia) element.textContent = data.julia
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const nodeVoltages = lastNodeVoltagesRef.current
    const nets = lastNetsRef.current
    if (!nodeVoltages || !nets) return
    updateVoltageOverlay(
      nodeVoltages,
      nets,
      simulationSettings.voltageDisplayMode ?? 'node',
      lastBranchCurrentsRef.current ?? undefined,
      simulationSettings.showBranchCurrents,
    )
  }, [simulationSettings.voltageDisplayMode, simulationSettings.showBranchCurrents, updateVoltageOverlay])

  // 戴维宁端口下拉：只按连线算网络（参数暂时无效也照样列出），并配上探针名 / 元件端子，学生才认得出是哪个结点
  const portNets = useMemo(() => {
    if (diagramMode !== 'electrical' || simulationSettings.method !== 'thevenin') return []
    return buildNets(nodes, edges).nets
  }, [nodes, edges, simulationSettings.method, diagramMode])
  const availableNodes = useMemo(() => portNets.map((net) => net.name), [portNets])
  const availableNodeLabels = useMemo(() => describeNets(nodes, portNets), [nodes, portNets])

  return {
    simulationSettings,
    simulationResult,
    simulationError,
    resultNets,
    isSimulating,
    showResultPanel,
    lastMethodUsed,
    teachingMode,
    theveninPort,
    availableNodes,
    availableNodeLabels,
    setSimulationResult,
    setSimulationError,
    setShowResultPanel,
    setTeachingMode,
    setTheveninPort,
    handleSimulationSettingsChange: setSimulationSettings,
    handleRunSimulation,
    resetSimulation,
    resultStale,
  }
}
