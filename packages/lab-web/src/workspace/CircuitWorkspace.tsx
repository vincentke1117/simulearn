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
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import {
  DND_COMPONENT_MIME,
  circuitComponentLibrary,
  circuitComponentList,
  type CircuitComponentType,
} from '@/circuit/components'
import type { CircuitNodeData } from '@/types/circuit'
import type { DiagramMode } from '@/types/control'
import { nextComponentIdFromNodes } from '@/utils/id'
import { ComponentPalette } from '@/palette/ComponentPalette'
import { InspectorPanel } from '@/panels/InspectorPanel'
import { circuitNodeTypes } from '@/canvas/nodeTypes'
import { StepBridgeEdge } from '@/canvas/StepBridgeEdge'
import { isResistiveCircuit } from '@/simulation/payload'
import { detectDiagramMode } from '@/simulation/diagramMode'
import { loadProjectFromObject } from './project'
import { EditorTopBar } from './EditorTopBar'
import { isRunDisabled } from '@/workspace/runGuard'
import {
  applyHandleCounts,
  createNodeData,
  downloadProject,
  parseProjectContent,
} from './circuitWorkspaceHelpers'
import { useWorkspaceSimulation, type WorkspaceMessage } from './useWorkspaceSimulation'

import styles from './CircuitWorkspace.module.css'

const SimulationResultPanel = lazy(() =>
  import('@/simulation/SimulationResultPanel').then((module) => ({ default: module.SimulationResultPanel })),
)

interface DragPayload {
  type: CircuitComponentType
}

function CircuitWorkspaceInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CircuitNodeData>>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [workspaceMessage, setWorkspaceMessage] = useState<WorkspaceMessage>(null)

  const reactFlow = useReactFlow<Node<CircuitNodeData>, Edge>()

  // Load pending project from localStorage if available
  useEffect(() => {
    try {
      const pending = localStorage.getItem('slp:lab:pending-project')
      if (pending) {
        const project = JSON.parse(pending)
        const result = loadProjectFromObject(project)
        if (result.ok && result.nodes && result.edges) {
          setNodes(result.nodes as Node<CircuitNodeData>[])
          setEdges(result.edges as Edge[])
        }
        localStorage.removeItem('slp:lab:pending-project')
        setWorkspaceMessage({ tone: 'info', text: '已加载示例电路' })
      }
    } catch (e) {
      console.error('Failed to load pending project:', e)
      setWorkspaceMessage({ tone: 'error', text: '加载示例电路失败' })
    }
  }, [setNodes, setEdges])

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

  const hasGround = useMemo(() => nodes.some((node) => node.type === 'ground'), [nodes])
  const componentLabels = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node.data.label ?? node.id])),
    [nodes],
  )
  const diagramMode = useMemo<DiagramMode>(() => detectDiagramMode(nodes), [nodes])

  useEffect(() => {
    setNodes((current) => applyHandleCounts(current, edges))
  }, [edges, setNodes])

  const {
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
    handleSimulationSettingsChange,
    handleRunSimulation,
  } = useWorkspaceSimulation({
    nodes,
    edges,
    diagramMode,
    reactFlow,
    setNodes,
    setWorkspaceMessage,
  })

  const canExport = nodes.length > 0
  const isResistive = useMemo(() => isResistiveCircuit(nodes), [nodes])
  const hasResult = Boolean(simulationResult && !simulationError)
  const runDisabled = isRunDisabled(diagramMode, hasGround)

  const handleExportProject = useCallback(() => {
    downloadProject(reactFlow.getNodes(), reactFlow.getEdges(), diagramMode)
    setWorkspaceMessage({ tone: 'info', text: '项目已导出' })
  }, [reactFlow, diagramMode])

  const handleImportProject = useCallback(
    async (content: string) => {
      setWorkspaceMessage(null)
      const result = parseProjectContent(content)
      if (!result.ok) {
        setWorkspaceMessage({ tone: 'error', text: result.message })
        return
      }

      setNodes(result.nodes)
      setEdges(result.edges)
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
    [reactFlow, setEdges, setNodes, setSimulationError, setSimulationResult],
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
  }, [setEdges, setNodes, setSimulationError, setSimulationResult])

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
            <Suspense fallback={<div className="p-4 text-sm text-slate-400">正在加载仿真结果…</div>}>
              <SimulationResultPanel
                result={simulationResult}
                error={simulationError}
                isRunning={isSimulating}
                method={lastMethodUsed}
                diagramMode={diagramMode}
                componentLabels={componentLabels}
                hasGround={hasGround}
                onClose={() => setShowResultPanel(false)}
              />
            </Suspense>
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
