import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'

import { runSimulationRequest } from '@/simulation/api'
import { buildControlSimulationPayload } from '@/simulation/controlPayload'
import { detectDiagramMode } from '@/simulation/diagramMode'
import { applyOverlay } from '@/simulation/mapping'
import { buildMixedSimulationPayload } from '@/simulation/mixedPayload'
import { buildSimulationPayload } from '@/simulation/payload'
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
} from './circuitWorkspaceHelpers'

export type WorkspaceMessage = { tone: 'info' | 'error'; text: string } | null

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
}

export interface WorkspaceSimulationState {
  simulationSettings: SimulationSettings
  simulationResult: AnalysisResultData | null
  simulationError: SimulationErrorInfo | null
  isSimulating: boolean
  showResultPanel: boolean
  lastMethodUsed: string | undefined
  teachingMode: boolean
  theveninPort: TheveninPortConfig | undefined
  availableNodes: string[]
  setSimulationResult: Dispatch<SetStateAction<AnalysisResultData | null>>
  setSimulationError: Dispatch<SetStateAction<SimulationErrorInfo | null>>
  setShowResultPanel: Dispatch<SetStateAction<boolean>>
  setTeachingMode: Dispatch<SetStateAction<boolean>>
  setTheveninPort: Dispatch<SetStateAction<TheveninPortConfig | undefined>>
  handleSimulationSettingsChange: (settings: SimulationSettings) => void
  handleRunSimulation: () => Promise<void>
}

export function useWorkspaceSimulation({
  nodes,
  edges,
  diagramMode,
  reactFlow,
  setNodes,
  setWorkspaceMessage,
}: UseWorkspaceSimulationOptions): WorkspaceSimulationState {
  const [simulationSettings, setSimulationSettings] = useState(initialSimulationSettings)
  const [simulationResult, setSimulationResult] = useState<AnalysisResultData | null>(null)
  const [simulationResultCache, setSimulationResultCache] = useState<Record<string, AnalysisResultData> | null>(null)
  const [simulationError, setSimulationError] = useState<SimulationErrorInfo | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [showResultPanel, setShowResultPanel] = useState(false)
  const [lastMethodUsed, setLastMethodUsed] = useState<string>()
  const [teachingMode, setTeachingMode] = useState(false)
  const [theveninPort, setTheveninPort] = useState<TheveninPortConfig>()
  const lastNetsRef = useRef<SimulationNetPayload[] | null>(null)
  const lastNodeVoltagesRef = useRef<Record<string, number> | null>(null)
  const lastBranchCurrentsRef = useRef<Record<string, number> | null>(null)

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

  const submitSingleRequest = useCallback(async (build: PayloadBuildResult) => {
    if (!build.ok || !build.payload) {
      setSimulationResult(null)
      setSimulationError({ message: build.errors.join('；') })
      return
    }
    const response = await runSimulationRequest(build.payload)
    if (response.status === 'ok') {
      setSimulationResult(response.data)
      setSimulationError(null)
      setSimulationResultCache(null)
      setLastMethodUsed('transient')
      setShowResultPanel(true)
    } else {
      setSimulationResult(null)
      setSimulationError({ message: response.message, code: response.code, data: response.data })
    }
  }, [])

  const handleRunSimulation = useCallback(async () => {
    const start = performance.now()
    const currentNodes = reactFlow.getNodes()
    const currentEdges = reactFlow.getEdges()
    const currentDiagramMode = detectDiagramMode(currentNodes)
    const switches = currentDiagramMode === 'electrical'
      ? currentNodes.filter((node) => node.type === 'switch').sort((left, right) => left.id.localeCompare(right.id))
      : []
    const isMultiScenario = switches.length > 0 && switches.length <= 4

    setNodes((current) => current.map((node) => ({
      ...node,
      data: {
        ...node.data,
        voltage: undefined,
        voltageDelta: undefined,
        current: undefined,
      },
    })))
    setIsSimulating(true)
    setSimulationError(null)
    setSimulationResult(null)
    setSimulationResultCache(null)

    try {
      if (currentDiagramMode === 'empty') {
        setSimulationResult(null)
        setSimulationError({ message: '请先在画布中放置元件' })
        return
      }

      if (currentDiagramMode === 'mixed') {
        await submitSingleRequest(buildMixedSimulationPayload(currentNodes, currentEdges, simulationSettings))
        return
      }

      if (currentDiagramMode === 'control') {
        await submitSingleRequest(buildControlSimulationPayload(currentNodes, currentEdges, simulationSettings))
        return
      }

      const applyAnalysisOptions = (payload: SimulationPayload) => {
        payload.teaching_mode = teachingMode
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
        const newCache: Record<string, AnalysisResultData> = {}
        let firstError: SimulationErrorInfo | null = null
        results.forEach((response, index) => {
          if (response.status === 'ok') newCache[signatures[index]] = response.data
          else if (!firstError) {
            firstError = { message: response.message, code: response.code, data: response.data }
          }
        })

        if (Object.keys(newCache).length === 0 && firstError) {
          setSimulationResult(null)
          setSimulationError(firstError)
          return
        }
        setSimulationResultCache(newCache)
        const currentResult = newCache[getSwitchStateSignature(currentNodes)]
        if (currentResult) {
          setSimulationResult(currentResult)
          setShowResultPanel(true)
          const currentBuild = buildSimulationPayload(currentNodes, currentEdges, simulationSettings)
          if (currentBuild.payload?.nets) applyResultToOverlay(currentResult, currentBuild.payload.nets)
          if (currentBuild.payload?.method) setLastMethodUsed(currentBuild.payload.method)
        }
      } else {
        const build = buildSimulationPayload(currentNodes, currentEdges, simulationSettings)
        if (!build.ok || !build.payload) {
          setSimulationResult(null)
          setSimulationError({ message: build.errors.join('；') })
          return
        }
        setLastMethodUsed(build.payload.method)
        applyAnalysisOptions(build.payload)
        const response = await runSimulationRequest(build.payload)
        if (response.status === 'ok') {
          setSimulationResult(response.data)
          setSimulationError(null)
          setShowResultPanel(true)
          if (build.payload.nets) applyResultToOverlay(response.data, build.payload.nets)
        } else {
          setSimulationResult(null)
          setSimulationError({ message: response.message, code: response.code, data: response.data })
        }
      }
    } catch (error) {
      setSimulationResult(null)
      setSimulationError({ message: error instanceof Error ? error.message : '仿真请求失败' })
    } finally {
      setIsSimulating(false)
      setWorkspaceMessage({ tone: 'info', text: `仿真往返时间 ${Math.round(performance.now() - start)}ms` })
    }
  }, [reactFlow, simulationSettings, setNodes, teachingMode, theveninPort, applyResultToOverlay, submitSingleRequest, setWorkspaceMessage])

  useEffect(() => {
    if (!simulationResultCache || detectDiagramMode(nodes) !== 'electrical') return
    const signature = getSwitchStateSignature(nodes)
    if (!signature) return
    const cachedResult = simulationResultCache[signature]
    if (cachedResult && cachedResult !== simulationResult) {
      setSimulationResult(cachedResult)
      const build = buildSimulationPayload(nodes, edges, simulationSettings)
      if (build.ok && build.payload?.nets) {
        applyResultToOverlay(cachedResult, build.payload.nets)
        if (build.payload.method) setLastMethodUsed(build.payload.method)
      }
    }
  }, [nodes, edges, simulationResultCache, simulationSettings, applyResultToOverlay, simulationResult])

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
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api/lab'
    fetch(`${apiBase}/version`).then(async (response) => {
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

  const availableNodes = useMemo(() => {
    if (diagramMode !== 'electrical' || simulationSettings.method !== 'thevenin') return []
    const build = buildSimulationPayload(nodes, edges, simulationSettings)
    return build.ok && build.payload?.nets ? build.payload.nets.map((net) => net.name) : []
  }, [nodes, edges, simulationSettings, diagramMode])

  return {
    simulationSettings,
    simulationResult,
    simulationError,
    isSimulating,
    showResultPanel,
    lastMethodUsed,
    teachingMode,
    theveninPort,
    availableNodes,
    setSimulationResult,
    setSimulationError,
    setShowResultPanel,
    setTeachingMode,
    setTheveninPort,
    handleSimulationSettingsChange: setSimulationSettings,
    handleRunSimulation,
  }
}
