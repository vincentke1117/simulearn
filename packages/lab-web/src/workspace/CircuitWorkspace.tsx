import {
  Background,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import {
  DND_COMPONENT_MIME,
  circuitComponentLibrary,
  circuitComponentList,
  type CircuitComponentDefinition,
  type CircuitComponentType,
} from '@/circuit/components'
import type {
  CircuitNodeData,
  SimulationSettings,
  AnalysisResultData,
  SimulationNetPayload,
  NodeVoltageResult,
  BranchCurrentResult,
  MeshCurrentResult,
  ComparisonResult,
  TheveninPortConfig,
} from '@/types/circuit'
import type { DiagramMode } from '@/types/control'
import { nextComponentIdFromNodes } from '@/utils/id'
import { ComponentPalette } from '@/palette/ComponentPalette'
import { InspectorPanel } from '@/panels/InspectorPanel'
import { SimulationResultPanel } from '@/simulation/SimulationResultPanel'
import { circuitNodeTypes } from '@/canvas/nodeTypes'
import { StepBridgeEdge } from '@/canvas/StepBridgeEdge'
import { buildSimulationPayload, isResistiveCircuit } from '@/simulation/payload'
import { buildControlSimulationPayload } from '@/simulation/controlPayload'
import { buildMixedSimulationPayload } from '@/simulation/mixedPayload'
import { detectDiagramMode } from '@/simulation/diagramMode'
import { runSimulationRequest } from '@/simulation/api'
import { buildProjectSnapshot, loadProjectFromObject } from './project'
import { applyOverlay } from '@/simulation/mapping'
import { EditorTopBar } from './EditorTopBar'
import { isRunDisabled } from '@/workspace/runGuard'

import styles from './CircuitWorkspace.module.css'

// ---- 类型守卫（模块级，避免 hooks 依赖告警） ----
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const hasNodeVoltages = (
  data: AnalysisResultData,
): data is NodeVoltageResult | BranchCurrentResult | MeshCurrentResult => isRecord(data) && 'node_voltages' in data

const isComparisonResult = (data: AnalysisResultData): data is ComparisonResult => {
  if (!isRecord(data)) return false
  // 排除明显的非比较结果结构
  if ('node_voltages' in data) return false
  if ('time' in data) return false
  if ('vth' in data) return false
  return true
}

const pickNodeVoltages = (data: AnalysisResultData): Record<string, number> | null => {
  if (!data) return null
  // 单方法：节点/支路/网孔方法都会包含 node_voltages
  if (hasNodeVoltages(data)) {
    return data.node_voltages
  }
  // 对比模式：优先使用节点电压法，其次支路电流法或网孔电流法
  if (isComparisonResult(data)) {
    const nv = data['node_voltage']
    const bc = data['branch_current']
    const mc = data['mesh_current']
    if (nv && hasNodeVoltages(nv)) return nv.node_voltages
    if (bc && hasNodeVoltages(bc)) return bc.node_voltages
    if (mc && hasNodeVoltages(mc)) return mc.node_voltages
    return null
  }
  return null
}

const hasBranchCurrents = (value: unknown): value is { branch_currents: Record<string, number> } => {
  if (!isRecord(value) || !('branch_currents' in value)) return false
  const candidate = (value as Record<string, unknown>).branch_currents
  return isRecord(candidate)
}

const pickBranchCurrents = (data: AnalysisResultData): Record<string, number> | null => {
  if (!data) return null
  if (hasBranchCurrents(data)) {
    return data.branch_currents as Record<string, number>
  }
  if (isComparisonResult(data)) {
    const bc = data['branch_current']
    const mc = data['mesh_current']
    if (hasBranchCurrents(bc)) return bc.branch_currents
    if (hasBranchCurrents(mc)) return mc.branch_currents
    return null
  }
  return null
}

interface DragPayload {
  type: CircuitComponentType
}

const initialSimulationSettings: SimulationSettings = {
  tStop: 1e-3,
  nSamples: 1000,
}

function createNodeData(definition: CircuitComponentDefinition<CircuitComponentType>): CircuitNodeData {
  const parameters = definition.parameters.reduce<Record<string, number>>((acc, parameter) => {
    if (typeof parameter.defaultValue === 'number') {
      acc[parameter.key] = parameter.defaultValue
    }
    return acc
  }, {})

  return {
    label: definition.prefix,
    type: definition.type,
    parameters,
  }
}

function getSwitchStateSignature(nodes: Node<CircuitNodeData>[]): string {
  const switches = nodes.filter((n) => n.type === 'switch').sort((a, b) => a.id.localeCompare(b.id))
  if (switches.length === 0) return ''
  return switches.map((s) => `${s.id}:${s.data.parameters?.state ?? 0}`).join('|')
}

function CircuitWorkspaceInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CircuitNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [simulationSettings, setSimulationSettings] = useState<SimulationSettings>(initialSimulationSettings)
  const [simulationResult, setSimulationResult] = useState<AnalysisResultData | null>(null)
  const [simulationResultCache, setSimulationResultCache] = useState<Record<string, AnalysisResultData> | null>(null)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [showResultPanel, setShowResultPanel] = useState(false)
  const [lastMethodUsed, setLastMethodUsed] = useState<string | undefined>(undefined)
  const [workspaceMessage, setWorkspaceMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  // 教学模式：显示求解步骤
  const [teachingMode, setTeachingMode] = useState<boolean>(false)
  // 戴维南端口配置
  const [theveninPort, setTheveninPort] = useState<TheveninPortConfig | undefined>(undefined)

  const reactFlow = useReactFlow()

  // Load pending project from localStorage if available
  useEffect(() => {
    try {
      const pending = localStorage.getItem('pendingProject')
      if (pending) {
        const project = JSON.parse(pending)
        const result = loadProjectFromObject(project)
        if (result.ok && result.nodes && result.edges) {
          setNodes(result.nodes as Node<CircuitNodeData>[])
          setEdges(result.edges as Edge[])
        }
        localStorage.removeItem('pendingProject')
        setWorkspaceMessage({ tone: 'info', text: '已加载示例电路' })
      }
    } catch (e) {
      console.error('Failed to load pending project:', e)
      setWorkspaceMessage({ tone: 'error', text: '加载示例电路失败' })
    }
  }, [setNodes, setEdges])

  // 保存最近一次 DC 仿真产生的网络与节点电压，供显示模式实时切换使用
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
    setNodes((prev) => applyOverlay(prev as Node<CircuitNodeData>[], nets, nodeVoltages, displayMode, branchCurrents, showBranchCurrents))
  }, [setNodes])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const payloadRaw = event.dataTransfer.getData(DND_COMPONENT_MIME)
      if (!payloadRaw) return

      const payload: DragPayload = JSON.parse(payloadRaw)
      const definition = circuitComponentLibrary[payload.type]
      if (!definition) return

      const projected = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      setNodes((currentNodes) => {
        const id = nextComponentIdFromNodes(currentNodes as Node<CircuitNodeData>[], definition)

        const node: Node<CircuitNodeData> = {
          id,
          type: definition.type,
          position: projected,
          data: {
            ...createNodeData(definition),
            label: id,
          },
        }

        return currentNodes.concat(node)
      })
    },
    [reactFlow, setNodes],
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      if (connection.source === connection.target) return

      // 统一使用 stepBridge 连线样式（带跳弧）
      setEdges((eds) => addEdge({ ...connection, type: 'stepBridge' }, eds))
    },
    [setEdges],
  )

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.target) return false
    if (connection.source === connection.target) return false
    return true
  }, [])

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId) ?? null, [nodes, selectedNodeId])
  const selectedDefinition = selectedNode ? circuitComponentLibrary[selectedNode.type as keyof typeof circuitComponentLibrary] : null

  const handleParameterChange = useCallback(
    (key: string, value: number) => {
      if (!selectedNodeId) return
      setNodes((current) =>
        current.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  parameters: {
                    ...node.data.parameters,
                    [key]: value,
                  },
                },
              }
            : node,
        ),
      )
    },
    [selectedNodeId, setNodes],
  )

  // 添加旋转处理函数
  const handleRotationChange = useCallback(
    (value: number) => {
      if (!selectedNodeId) return
      setNodes((current) =>
        current.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  rotation: value,
                },
              }
            : node,
        ),
      )
    },
    [selectedNodeId, setNodes],
  )

  // 添加字体大小修改函数
  const handleFontSizeChange = useCallback(
    (value: number) => {
      if (!selectedNodeId) return
      setNodes((current) =>
        current.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  fontSize: value,
                },
              }
            : node,
        ),
      )
    },
    [selectedNodeId, setNodes],
  )

  const handleSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node<CircuitNodeData>[] }) => {
    setSelectedNodeId(selectedNodes[0]?.id ?? null)
  }, [])

  const handleSimulationSettingsChange = useCallback((settings: SimulationSettings) => {
    setSimulationSettings(settings)
  }, [])

  const hasGround = useMemo(() => nodes.some((node) => node.type === 'ground'), [nodes])
  const diagramMode = useMemo<DiagramMode>(() => detectDiagramMode(nodes as Node<CircuitNodeData>[]), [nodes])
  const canExport = nodes.length > 0
  const isResistive = useMemo(() => isResistiveCircuit(nodes as Node<CircuitNodeData>[]), [nodes])
  const hasResult = !!(simulationResult && !simulationError)
  const runDisabled = isRunDisabled(diagramMode, hasGround)

  const handleExportProject = useCallback(() => {
    const snapshot = buildProjectSnapshot(reactFlow.getNodes() as Node<CircuitNodeData>[], reactFlow.getEdges())
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `jcircuit-${new Date().toISOString().replace(/[.:]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setWorkspaceMessage({ tone: 'info', text: '项目已导出' })
  }, [reactFlow])

  const handleImportProject = useCallback(
    async (content: string) => {
      setWorkspaceMessage(null)
      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch {
        setWorkspaceMessage({ tone: 'error', text: '导入失败：JSON 格式错误' })
        return
      }

      const result = loadProjectFromObject(parsed)
      if (!result.ok || !result.nodes || !result.edges) {
        const message = result.errors.join('；') || '导入失败：项目结构无效'
        setWorkspaceMessage({ tone: 'error', text: message })
        return
      }

      setNodes(result.nodes as Node<CircuitNodeData>[])
      // 导入的边统一设置为 stepBridge 类型以确保画面风格一致
      setEdges((result.edges as Edge[]).map(e => ({ ...e, type: 'stepBridge' })))
      setSelectedNodeId(null)
      setSimulationResult(null)
      setSimulationError(null)
      setWorkspaceMessage({ tone: 'info', text: '项目导入成功' })

      setTimeout(() => {
        try {
          reactFlow.fitView({ padding: 0.2 })
        } catch {
          // ignore viewport fit errors
        }
      }, 50)
    },
    [reactFlow, setEdges, setNodes],
  )

  const handleImportError = useCallback((message: string) => {
    setWorkspaceMessage({ tone: 'error', text: message })
  }, [])

  const handleReset = useCallback(() => {
    if (confirm('确定要清空当前电路吗？')) {
      setNodes([])
      setEdges([])
      setSimulationResult(null)
      setSimulationError(null)
      setWorkspaceMessage({ tone: 'info', text: '电路已重置' })
    }
  }, [setNodes, setEdges])

  // 根据边更新各节点端口的连接数量，用于在端口上显示“连接点”标记
  useEffect(() => {
    const countsByNode: Record<string, Record<string, number>> = {}
    for (const e of edges) {
      if (e.source && e.sourceHandle) {
        countsByNode[e.source] ??= {}
        countsByNode[e.source][e.sourceHandle] = (countsByNode[e.source][e.sourceHandle] ?? 0) + 1
      }
      if (e.target && e.targetHandle) {
        countsByNode[e.target] ??= {}
        countsByNode[e.target][e.targetHandle] = (countsByNode[e.target][e.targetHandle] ?? 0) + 1
      }
    }

    setNodes((prev) => {
      let changed = false
      const next = prev.map((node) => {
        const nextCounts = countsByNode[node.id] ?? {}
        const prevCounts = (node.data as { handleCounts?: Record<string, number> }).handleCounts

        const same = (() => {
          if (!prevCounts) return Object.keys(nextCounts).length === 0
          const keysPrev = Object.keys(prevCounts)
          const keysNext = Object.keys(nextCounts)
          if (keysPrev.length !== keysNext.length) return false
          for (const k of keysPrev) {
            if (prevCounts[k] !== nextCounts[k]) return false
          }
          return true
        })()

        if (!same) {
          changed = true
          return {
            ...node,
            data: {
              ...node.data,
              handleCounts: nextCounts,
            },
          }
        }
        return node
      })
      return changed ? next : prev
    })
  }, [edges, setNodes])

  const availableNodes = useMemo(() => {
    if (diagramMode !== 'electrical' || simulationSettings.method !== 'thevenin') return []
    const build = buildSimulationPayload(nodes as Node<CircuitNodeData>[], edges, simulationSettings)
    if (!build.ok || !build.payload || !build.payload.nets) return []
    return build.payload.nets.map(n => n.name)
  }, [nodes, edges, simulationSettings, diagramMode])

  const applyResultToOverlay = useCallback((data: AnalysisResultData, nets: SimulationNetPayload[]) => {
    try {
      const nodeVoltages = pickNodeVoltages(data)
      const branchCurrents = pickBranchCurrents(data)

      if (nodeVoltages) {
        const displayMode = simulationSettings.voltageDisplayMode ?? 'node'
        lastNetsRef.current = nets
        lastNodeVoltagesRef.current = nodeVoltages
        lastBranchCurrentsRef.current = branchCurrents || null
        updateVoltageOverlay(nodeVoltages, nets, displayMode, branchCurrents || undefined, simulationSettings.showBranchCurrents)
      } else {
        lastNetsRef.current = null
        lastNodeVoltagesRef.current = null
        lastBranchCurrentsRef.current = null
      }
    } catch (e) {
      console.warn('电压显示映射失败', e)
    }
  }, [simulationSettings.voltageDisplayMode, simulationSettings.showBranchCurrents, updateVoltageOverlay])

  const handleRunSimulation = useCallback(async () => {
    const start = performance.now()
    const currentNodes = reactFlow.getNodes() as Node<CircuitNodeData>[]
    const currentEdges = reactFlow.getEdges()
    const currentDiagramMode = detectDiagramMode(currentNodes)
    
    // 识别开关并检查是否启用多状态仿真
    const switches = currentDiagramMode === 'electrical'
      ? currentNodes.filter(n => n.type === 'switch').sort((a, b) => a.id.localeCompare(b.id))
      : []
    const isMultiScenario = switches.length > 0 && switches.length <= 4

    // 运行仿真前清除之前的电压显示
    setNodes((prev) => prev.map((node) => ({
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
        setSimulationError('请先在画布中放置元件')
        return
      }

      if (currentDiagramMode === 'mixed') {
        const buildMixed = buildMixedSimulationPayload(currentNodes, currentEdges, simulationSettings)
        if (!buildMixed.ok || !buildMixed.payload) {
          setSimulationResult(null)
          setSimulationError(buildMixed.errors.join('；'))
          return
        }

        const response = await runSimulationRequest(buildMixed.payload)
        if (response.status === 'ok') {
          setSimulationResult(response.data)
          setSimulationError(null)
          setSimulationResultCache(null)
          setLastMethodUsed('transient')
          setShowResultPanel(true)
        } else {
          const detail = response.data ? `（详情：${JSON.stringify(response.data)}）` : ''
          setSimulationResult(null)
          setSimulationError(`${response.message}${detail}`)
        }
        return
      }

      if (currentDiagramMode === 'control') {
        const buildControl = buildControlSimulationPayload(currentNodes, currentEdges, simulationSettings)
        if (!buildControl.ok || !buildControl.payload) {
          setSimulationResult(null)
          setSimulationError(buildControl.errors.join('；'))
          return
        }

        const response = await runSimulationRequest(buildControl.payload)
        if (response.status === 'ok') {
          setSimulationResult(response.data)
          setSimulationError(null)
          setSimulationResultCache(null)
          setLastMethodUsed('transient')
          setShowResultPanel(true)
        } else {
          const detail = response.data ? `（详情：${JSON.stringify(response.data)}）` : ''
          setSimulationResult(null)
          setSimulationError(`${response.message}${detail}`)
        }
        return
      }

      if (isMultiScenario) {
         const combinations = 1 << switches.length
         const promises = []
         const signatures: string[] = []
         
         for (let i = 0; i < combinations; i++) {
             const scenarioNodes = currentNodes.map(node => {
                 if (node.type === 'switch') {
                     const idx = switches.findIndex(s => s.id === node.id)
                     const state = (i >> idx) & 1
                     return {
                         ...node,
                         data: { ...node.data, parameters: { ...node.data.parameters, state } }
                     }
                 }
                 return node
             })
             
             const build = buildSimulationPayload(scenarioNodes, currentEdges, simulationSettings)
             if (!build.ok || !build.payload) {
                 throw new Error(build.errors.join('；'))
             }
             
             build.payload.teaching_mode = teachingMode
             if (simulationSettings.method === 'thevenin' && theveninPort) {
                 build.payload.thevenin_port = { positive: theveninPort.positiveNode, negative: theveninPort.negativeNode }
             }
             
             signatures.push(getSwitchStateSignature(scenarioNodes))
             promises.push(runSimulationRequest(build.payload).then(res => ({ res, nets: build.payload?.nets })))
         }
         
         const results = await Promise.all(promises)
         
         const newCache: Record<string, AnalysisResultData> = {}
         let firstError: string | null = null
         
         results.forEach(({ res }, idx) => {
             if (res.status === 'ok') {
                 newCache[signatures[idx]] = res.data
             } else {
                 if (!firstError) firstError = res.message
             }
         })
         
         if (Object.keys(newCache).length === 0 && firstError) {
             throw new Error(firstError)
         }
         
         setSimulationResultCache(newCache)
         
         // 应用当前状态的结果
         const currentSig = getSwitchStateSignature(currentNodes)
         const currentResult = newCache[currentSig]
         
         if (currentResult) {
             setSimulationResult(currentResult)
             setShowResultPanel(true)
             const currentBuild = buildSimulationPayload(currentNodes, currentEdges, simulationSettings)
             if (currentBuild.payload?.nets) {
                 applyResultToOverlay(currentResult, currentBuild.payload.nets as SimulationNetPayload[])
             }
             if (currentBuild.payload?.method) {
                 setLastMethodUsed(currentBuild.payload.method)
             }
         }
      } else {
        // 单次仿真逻辑
        const build = buildSimulationPayload(currentNodes, currentEdges, simulationSettings)
        if (!build.ok || !build.payload) {
          setSimulationResult(null)
          setSimulationError(build.errors.join('；'))
          return
        }

        setLastMethodUsed(build.payload.method)
        build.payload.teaching_mode = teachingMode

        if (simulationSettings.method === 'thevenin' && theveninPort) {
          build.payload.thevenin_port = {
            positive: theveninPort.positiveNode,
            negative: theveninPort.negativeNode
          }
        }

        const response = await runSimulationRequest(build.payload)
        if (response.status === 'ok') {
          setSimulationResult(response.data)
          setSimulationError(null)
          setShowResultPanel(true)
          if (build.payload.nets) {
            applyResultToOverlay(response.data, build.payload.nets as SimulationNetPayload[])
          }
        } else {
          const detail = response.data ? `（详情：${JSON.stringify(response.data)}）` : ''
          setSimulationResult(null)
          setSimulationError(`${response.message}${detail}`)
        }
      }
    } catch (error) {
      setSimulationResult(null)
      setSimulationError(error instanceof Error ? error.message : '仿真请求失败')
    } finally {
      setIsSimulating(false)
      const end = performance.now()
      const latencyMs = Math.round(end - start)
      setWorkspaceMessage({ tone: 'info', text: `仿真往返时间 ${latencyMs}ms` })
    }
  }, [reactFlow, simulationSettings, setNodes, teachingMode, theveninPort, applyResultToOverlay])

  // 监听开关状态变化，应用缓存的仿真结果
  useEffect(() => {
    if (!simulationResultCache) return
    if (detectDiagramMode(nodes as Node<CircuitNodeData>[]) !== 'electrical') return
    
    const signature = getSwitchStateSignature(nodes)
    if (!signature) return

    const cachedResult = simulationResultCache[signature]
    if (cachedResult && cachedResult !== simulationResult) {
        setSimulationResult(cachedResult)
        const build = buildSimulationPayload(nodes as Node<CircuitNodeData>[], edges, simulationSettings)
        if (build.ok && build.payload?.nets) {
            applyResultToOverlay(cachedResult, build.payload.nets as SimulationNetPayload[])
            if (build.payload.method) {
                setLastMethodUsed(build.payload.method)
            }
        }
    }
  }, [nodes, edges, simulationResultCache, simulationSettings, applyResultToOverlay, simulationResult])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        if (!isSimulating) handleRunSimulation()
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault()
        setShowResultPanel((s) => !s)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleRunSimulation, isSimulating])

  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'
    fetch(`${apiBase}/version`).then(async (res) => {
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      const el = document.getElementById('server-version')
      if (el && data && data.julia) {
        el.textContent = data.julia
      }
    }).catch(() => {})
  }, [])

  // 切换电压显示模式或支路电流显示开关时，基于最近一次 DC 仿真结果实时刷新电压覆盖
  useEffect(() => {
    const nodeVoltages = lastNodeVoltagesRef.current
    const nets = lastNetsRef.current
    const branchCurrents = lastBranchCurrentsRef.current
    if (!nodeVoltages || !nets) return
    const displayMode = simulationSettings.voltageDisplayMode ?? 'node'
    // 始终传递支路电流数据，但通过 showBranchCurrents 参数控制普通元件是否显示
    updateVoltageOverlay(nodeVoltages, nets, displayMode, branchCurrents || undefined, simulationSettings.showBranchCurrents)
  }, [simulationSettings.voltageDisplayMode, simulationSettings.showBranchCurrents, updateVoltageOverlay])

  return (
    <div className={styles.workspace}>
      <ComponentPalette components={circuitComponentList} />
      <div className={styles.canvasArea}>
        <EditorTopBar
          onExport={handleExportProject}
          onImport={handleImportProject}
          onImportError={handleImportError}
          canExport={canExport}
          onReset={handleReset}
          settings={simulationSettings}
          onSettingsChange={handleSimulationSettingsChange}
          onRun={handleRunSimulation}
          disabled={runDisabled}
          isRunning={isSimulating}
          isResistive={isResistive}
          diagramMode={diagramMode}
          hasResult={hasResult}
          onShowResult={() => setShowResultPanel(true)}
          showResultPanel={showResultPanel}
          theveninPort={theveninPort}
          onTheveninPortChange={setTheveninPort}
          availableNodes={availableNodes}
          teachingMode={teachingMode}
          onTeachingModeChange={setTeachingMode}
          message={workspaceMessage}
        />
        <div
          className={styles.canvasContainer}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            nodeTypes={circuitNodeTypes}
            edgeTypes={{ stepBridge: StepBridgeEdge }}
            connectionMode={ConnectionMode.Strict}
            isValidConnection={isValidConnection}
            onSelectionChange={handleSelectionChange}
            fitView
            minZoom={0.25}
            maxZoom={1.5}
            // 画布连线统一采用 stepBridge 样式
            defaultEdgeOptions={{ type: 'stepBridge' }}
            connectionLineType={ConnectionLineType.SmoothStep}
          >
            <Background gap={20} color="#334155" />
            <Controls position="bottom-right" className="!bg-slate-800 !border-slate-700 [&>button]:!border-slate-700 [&>button]:!bg-slate-800 [&>button]:!text-slate-200 [&>button:hover]:!bg-slate-700 [&>button_svg]:!fill-slate-200 [&>button_path]:!fill-slate-200" />
          </ReactFlow>
        </div>
        <AnimatePresence>
          {showResultPanel && (
              <SimulationResultPanel
              result={simulationResult}
              error={simulationError}
              isRunning={isSimulating}
              method={lastMethodUsed}
              onClose={() => setShowResultPanel(false)}
              />
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {selectedNode && selectedDefinition && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 288, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="h-full flex-shrink-0 overflow-hidden"
          >
            <InspectorPanel
              node={selectedNode.data}
              definition={selectedDefinition}
              onParameterChange={handleParameterChange}
              onRotationChange={handleRotationChange}
              onFontSizeChange={handleFontSizeChange}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function CircuitWorkspace() {
  return (
    <ReactFlowProvider>
      <CircuitWorkspaceInner />
    </ReactFlowProvider>
  )
}
