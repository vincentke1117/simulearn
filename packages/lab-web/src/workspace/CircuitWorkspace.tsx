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
  type EdgeChange,
  type FitViewOptions,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import {
  DND_COMPONENT_MIME,
  circuitComponentLibrary,
  circuitComponentList,
  type CircuitComponentType,
} from '@/circuit/components'
import type { CircuitNodeData, SimulationSettings, TheveninPortConfig } from '@/types/circuit'
import type { DiagramMode } from '@/types/control'
import { nextComponentIdFromNodes } from '@/utils/id'
import { ComponentPalette } from '@/palette/ComponentPalette'
import { InspectorPanel } from '@/panels/InspectorPanel'
import { circuitNodeTypes } from '@/canvas/nodeTypes'
import { StepBridgeEdge } from '@/canvas/StepBridgeEdge'
import { buildNets, isResistiveCircuit } from '@/simulation/payload'
import { describeNets } from '@/simulation/netLabels'
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
import { clearDraft, readDraft, writeDraft, type EmbedCircuit } from '@/embed/circuit'
import { flushPageStorage } from '@/embed/storage'
import { circuitSignature } from '@/embed/protocol'
import { dropRemovals } from './topologyLock'

import styles from './CircuitWorkspace.module.css'

const SimulationResultPanel = lazy(() =>
  import('@/simulation/SimulationResultPanel').then((module) => ({ default: module.SimulationResultPanel })),
)

interface DragPayload {
  type: CircuitComponentType
}

/** 嵌入知帆课堂时（#/embed）由 EmbedPage 传入：课程给的初始电路，以及按实验隔离的存储前缀 */
export interface WorkspaceEmbed {
  storagePrefix: string
  fingerprint: string
  initial: EmbedCircuit
  /**
   * 案例库里打开的案例：预设的分析设置（「恢复初始电路」时一并恢复）、说明卡片、回到列表。
   * 戴维宁端口写成引用（探针 id 或「元件 id.端子」），按实际加载的电路（草稿或初始电路）换成网络名：
   * 网络编号随连线顺序变，按初始电路算好的 n1、n2 不一定对得上草稿
   */
  preset?: { settings: SimulationSettings; theveninRefs?: { positive: string; negative: string } }
  guide?: ReactNode
  onBack?: () => void
}

function presetTheveninPort(embed: WorkspaceEmbed | undefined, circuit: EmbedCircuit): TheveninPortConfig | undefined {
  const refs = embed?.preset?.theveninRefs
  if (!refs) return undefined
  // 只按连线算网络：草稿里某个参数暂时无效（比如 0 Ω）时，完整构造请求会失败，端口就丢了
  const { handleNetMap } = buildNets(circuit.nodes, circuit.edges)
  const resolve = (ref: string) => {
    if (ref === 'gnd') return 'gnd'
    const [id, handle] = ref.includes('.') ? ref.split('.') : [ref, 'node']
    return handleNetMap.get(`${id}:${handle}`)
  }
  const positiveNode = resolve(refs.positive)
  const negativeNode = resolve(refs.negative)
  return positiveNode && negativeNode ? { positiveNode, negativeNode } : undefined
}

function CircuitWorkspaceInner({ embed }: { embed?: WorkspaceEmbed }) {
  // 嵌入模式：有和这份课程电路配套的草稿就接着上次改，没有就从初始电路开始
  const [start] = useState(() => {
    if (!embed) return { nodes: [], edges: [], restored: false }
    const draft = readDraft(embed.storagePrefix, embed.fingerprint)
    return draft ? { ...draft, restored: true } : { ...embed.initial, restored: false }
  })
  const [startPort] = useState(() => presetTheveninPort(embed, start))
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CircuitNodeData>>(start.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(start.edges)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [workspaceMessage, setWorkspaceMessage] = useState<WorkspaceMessage>(
    start.restored ? { tone: 'info', text: '已恢复你上次的修改；点「恢复初始电路」可以重新开始' } : null,
  )

  const reactFlow = useReactFlow<Node<CircuitNodeData>, Edge>()
  // 设计记录 D19：嵌入且没有任务时拓扑锁定——不能增删元件和连线，参数照常可改，位置可以拖
  const locked = Boolean(embed)
  // 案例说明卡浮在画布左上角：适配视图时左边多留出它的宽度，电路不被挡住
  const fitPadding = useMemo<FitViewOptions['padding']>(
    () => (embed?.guide ? { top: '40px', right: '40px', bottom: '40px', left: '380px' } : 0.2),
    [embed],
  )
  const baseline = useMemo(
    () => (embed ? circuitSignature(embed.initial.nodes, embed.initial.edges) : ''),
    [embed],
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<CircuitNodeData>>[]) => onNodesChange(dropRemovals(changes, locked)),
    [locked, onNodesChange],
  )
  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => onEdgesChange(dropRemovals(changes, locked)),
    [locked, onEdgesChange],
  )

  // 草稿防抖写入（拖动时每帧都在变）。还没写出去的那一次，在页面被宿主卸掉（「重新启动」、切场景会直接移除 iframe）
  // 或组件卸载时立即落盘，否则最后半秒的修改会丢。
  // 嵌入时草稿存在内核镜像里（embed/storage.ts），镜像自己监听 pagehide / visibilitychange，用 keepalive 把改动发给内核，
  // 而且它注册得比这里早。这里用捕获阶段注册：事件就发在 window / document 本身，目标阶段捕获监听先于普通监听触发
  // （现行 DOM 规范，Chromium 89+），草稿先写进镜像，镜像随后一次发完。不能这里再 flush 一次：
  // 两个 keepalive 并行发出，到内核的先后没有保证，旧的一份可能盖掉新的；两份合计超过 64 KB 时后一个还会被浏览器拒掉
  const pendingDraft = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!embed) return
    const write = () => {
      pendingDraft.current = null
      writeDraft(embed.storagePrefix, embed.fingerprint, baseline, nodes, edges)
    }
    pendingDraft.current = write
    const timer = setTimeout(write, 500)
    return () => clearTimeout(timer)
  }, [embed, baseline, nodes, edges])
  useEffect(() => {
    const writePending = () => pendingDraft.current?.()
    const onHidden = () => {
      if (document.visibilityState === 'hidden') writePending()
    }
    window.addEventListener('pagehide', writePending, { capture: true })
    document.addEventListener('visibilitychange', onHidden, { capture: true })
    return () => {
      window.removeEventListener('pagehide', writePending, { capture: true })
      document.removeEventListener('visibilitychange', onHidden, { capture: true })
      // 组件卸载（换案例、回列表）时页面还在，普通请求就行
      writePending()
      flushPageStorage()
    }
  }, [])

  // 宿主的课堂舞台大小不固定（约定 §4），窗口一变就重新适配一次。
  // 宿主刚把 iframe 塞进课堂时尺寸还在变，画布初始化时的 fitView 会按旧尺寸缩放，所以开头再补一次
  useEffect(() => {
    if (!embed) return
    const fit = () => reactFlow.fitView({ padding: fitPadding })
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(fit, 300)
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(fit, 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [embed, reactFlow, fitPadding])

  // Load pending project from localStorage if available
  useEffect(() => {
    if (embed) return
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
  }, [embed, setNodes, setEdges])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (locked) return
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
    [locked, reactFlow, setNodes],
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (locked) return
      if (!connection.source || !connection.target) return
      if (connection.source === connection.target) return

      // 统一使用 stepBridge 连线样式（带跳弧）
      setEdges((eds) => addEdge({ ...connection, type: 'stepBridge' }, eds))
    },
    [locked, setEdges],
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
    availableNodeLabels,
    setShowResultPanel,
    setTeachingMode,
    setTheveninPort,
    handleSimulationSettingsChange,
    handleRunSimulation,
    resetSimulation,
    resultStale,
    resultNets,
  } = useWorkspaceSimulation({
    nodes,
    edges,
    diagramMode,
    reactFlow,
    setNodes,
    setWorkspaceMessage,
    initialSettings: embed?.preset?.settings,
    initialTheveninPort: startPort,
  })

  const canExport = nodes.length > 0
  // 结果表的行名（n1、n2…）旁边括上探针名 / 元件端子，学生才对得上画布。按算出这个结果的那次请求的网络，
  // 不按当前画布现算：连线删了再连回去，网络会换号，旧数值就配上了别的网络的说明
  const netLabels = useMemo(
    () => (resultNets ? describeNets(nodes, resultNets) : undefined),
    [nodes, resultNets],
  )
  const isResistive = useMemo(() => isResistiveCircuit(nodes), [nodes])
  const hasAcSource = useMemo(() => nodes.some((node) => node.type === 'vsource_ac' || node.type === 'isource_ac'), [nodes])
  const hasProbe = useMemo(() => nodes.some((node) => node.type === 'voltage_probe' || node.type === 'current_probe'), [nodes])
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
      resetSimulation()
      setWorkspaceMessage({ tone: 'info', text: '项目导入成功' })

      setTimeout(() => {
        try {
          reactFlow.fitView({ padding: 0.2 })
        } catch {
          // ignore viewport fit errors
        }
      }, 50)
    },
    [reactFlow, resetSimulation, setEdges, setNodes],
  )

  const handleImportError = useCallback((message: string) => {
    setWorkspaceMessage({ tone: 'error', text: message })
  }, [])

  const handleReset = useCallback(() => {
    if (confirm('确定要清空当前电路吗？')) {
      setNodes([])
      setEdges([])
      resetSimulation()
      setWorkspaceMessage({ tone: 'info', text: '电路已重置' })
    }
  }, [resetSimulation, setEdges, setNodes])

  const handleRestoreInitial = useCallback(() => {
    if (!embed) return
    // 初始节点不带结点黑圈计数；edges 多半还是同一个引用，setEdges 不会触发按 edges 重算黑圈的 effect
    setNodes(applyHandleCounts(embed.initial.nodes, embed.initial.edges))
    setEdges(embed.initial.edges)
    clearDraft(embed.storagePrefix)
    setSelectedNodeId(null)
    resetSimulation()
    if (embed.preset) {
      handleSimulationSettingsChange(embed.preset.settings)
      setTheveninPort(presetTheveninPort(embed, embed.initial))
    }
    setWorkspaceMessage({ tone: 'info', text: '已恢复初始电路' })
    setTimeout(() => {
      try {
        reactFlow.fitView({ padding: fitPadding })
      } catch {
        // ignore viewport fit errors
      }
    }, 50)
  }, [embed, reactFlow, resetSimulation, setEdges, setNodes, handleSimulationSettingsChange, setTheveninPort, fitPadding])

  return (
    <div className={styles.workspace}>
      {!locked && <ComponentPalette components={circuitComponentList} />}
      <div className={styles.canvasArea}>
        <EditorTopBar
          onExport={handleExportProject}
          onImport={handleImportProject}
          onImportError={handleImportError}
          canExport={canExport}
          onReset={embed ? undefined : handleReset}
          onRestoreInitial={embed ? handleRestoreInitial : undefined}
          // 回列表前先把防抖里还没写出去的草稿落盘：列表上的「改过参数」要在这次渲染里就看得到
          onBack={embed?.onBack ? () => { pendingDraft.current?.(); flushPageStorage(); embed.onBack?.() } : undefined}
          settings={simulationSettings}
          onSettingsChange={handleSimulationSettingsChange}
          onRun={handleRunSimulation}
          disabled={runDisabled}
          isRunning={isSimulating}
          isResistive={isResistive}
          hasAcSource={hasAcSource}
          hasProbe={hasProbe}
          diagramMode={diagramMode}
          hasResult={hasResult}
          onShowResult={() => setShowResultPanel(true)}
          showResultPanel={showResultPanel}
          theveninPort={theveninPort}
          onTheveninPortChange={setTheveninPort}
          availableNodes={availableNodes}
          availableNodeLabels={availableNodeLabels}
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
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            nodesConnectable={!locked}
            deleteKeyCode={locked ? null : 'Backspace'}
            nodeTypes={circuitNodeTypes}
            edgeTypes={{ stepBridge: StepBridgeEdge }}
            connectionMode={ConnectionMode.Strict}
            isValidConnection={isValidConnection}
            onSelectionChange={handleSelectionChange}
            fitView
            fitViewOptions={{ padding: fitPadding }}
            minZoom={0.25}
            maxZoom={1.5}
            // 画布连线统一采用 stepBridge 样式
            defaultEdgeOptions={{ type: 'stepBridge' }}
            connectionLineType={ConnectionLineType.SmoothStep}
          >
            <Background gap={20} color="#334155" />
            <Controls position="bottom-right" className="!bg-slate-800 !border-slate-700 [&>button]:!border-slate-700 [&>button]:!bg-slate-800 [&>button]:!text-slate-200 [&>button:hover]:!bg-slate-700 [&>button_svg]:!fill-slate-200 [&>button_path]:!fill-slate-200" />
          </ReactFlow>
          {embed?.guide}
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
                netLabels={netLabels}
                hasGround={hasGround}
                allowExport={!embed}
                stale={resultStale}
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

export function CircuitWorkspace({ embed }: { embed?: WorkspaceEmbed } = {}) {
  return (
    <ReactFlowProvider>
      <CircuitWorkspaceInner embed={embed} />
    </ReactFlowProvider>
  )
}
