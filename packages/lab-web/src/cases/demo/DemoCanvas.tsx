import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import {
  Background,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
  type XYPosition,
} from '@xyflow/react'
import { animate } from 'framer-motion'

import { circuitNodeTypes } from '@/canvas/nodeTypes'
import { StepBridgeEdge } from '@/canvas/StepBridgeEdge'
import type { CircuitNodeData } from '@/types/circuit'
import { applyHandleCounts } from '@/workspace/circuitWorkspaceHelpers'
import { DemoNoteNode, type DemoNoteData } from './DemoNoteNode'
import type { DemoCircuit } from './demoPayload'
import { interpolate, keyedEdges, mergeEdges, mergeNodes, unionBounds } from './transition'
import type { DemoNote } from './types'
import styles from './demo.module.css'

// 模块级常量：每次渲染给新对象会让 xyflow 重挂全部节点，动画就没了
const NODE_TYPES: NodeTypes = { ...circuitNodeTypes, demoNote: DemoNoteNode }
const EDGE_TYPES = { stepBridge: StepBridgeEdge }
const MOVE_MS = 700
const LEAVE_MS = 600

export interface DemoFrame {
  circuit: DemoCircuit
  highlight?: string[]
  dim?: string[]
  notes?: DemoNote[]
  hideHandleLabels?: string[]
  /** 给元件写读数（applyOverlay 之后的 data）；不给就不标 */
  decorate?: (nodes: Node<CircuitNodeData>[]) => Node<CircuitNodeData>[]
}

type AnyNode = Node<CircuitNodeData> | Node<DemoNoteData>

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function noteNodes(notes: DemoNote[] | undefined, positions: Map<string, XYPosition>): Node<DemoNoteData>[] {
  return (notes ?? []).map((note) => {
    const anchor = note.anchor ? positions.get(note.anchor) : undefined
    const position = anchor
      ? { x: anchor.x + (note.dx ?? 0), y: anchor.y + (note.dy ?? -60) }
      : { x: note.x ?? 0, y: note.y ?? 0 }
    return {
      id: `note:${note.id}`,
      type: 'demoNote',
      position,
      data: { text: note.text, tone: note.tone },
      className: 'demo-note',
      selectable: false,
      draggable: false,
      zIndex: 10,
    }
  })
}

/**
 * 演示画布：只读的第二个 React Flow 实例（外层 DemoPlayer 包了自己的 Provider、id 也不同）。
 * 换帧时保留同 id 元件的节点对象（保住 measured），位置逐帧插值；新出现的淡入，离开的淡出后移除。
 * 视图只在打开时按所有帧的包围盒适配一次（或点「适应画布」），之后不跟着元件多少缩放。
 */
export function DemoCanvas({ frame, allPositions, fitSignal, children }: {
  frame: DemoFrame
  allPositions: XYPosition[]
  fitSignal: number
  children?: ReactNode
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<AnyNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { fitBounds } = useReactFlow()
  const initialized = useNodesInitialized()
  const animation = useRef<{ stop: () => void; finish: () => void } | null>(null)
  // React 的 setState 回调不是同步执行的：合并要基于上一次提交的节点，所以用 ref 跟住当前值
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fit = useCallback((duration = 0) => {
    void fitBounds(unionBounds(allPositions), { padding: 0.12, duration })
  }, [allPositions, fitBounds])

  useEffect(() => {
    // 上一段还没走完就翻页：直接跳到终点再开始新的一段
    animation.current?.finish()
    if (leaveTimer.current) clearTimeout(leaveTimer.current)

    const highlight = new Set(frame.highlight ?? [])
    const dim = new Set(frame.dim ?? [])
    const hideLabels = new Set(frame.hideHandleLabels ?? [])
    const circuitNodes = applyHandleCounts(frame.circuit.nodes, frame.circuit.edges)
    const decorated = frame.decorate ? frame.decorate(circuitNodes) : circuitNodes
    const targetPositions = new Map(decorated.map((node) => [node.id, node.position]))
    const target: AnyNode[] = [
      ...decorated.map((node) => ({ ...node, draggable: false, selectable: false })),
      ...noteNodes(frame.notes, targetPositions),
    ]
    const classOf = (node: AnyNode, entering: boolean) => [
      entering && node.type !== 'demoNote' ? 'demo-enter' : '',
      node.type === 'demoNote' ? 'demo-note' : '',
      highlight.has(node.id) ? 'demo-highlight' : '',
      dim.has(node.id) ? 'demo-dim' : '',
      hideLabels.has(node.id) ? 'demo-hide-handle-labels' : '',
    ].filter(Boolean).join(' ')

    // 气泡不参与位移插值：每一帧重新淡入
    const merged = mergeNodes(nodesRef.current.filter((node) => node.type !== 'demoNote'), target, classOf)
    setNodes(merged.nodes)
    setEdges(mergeEdges(edgesRef.current, keyedEdges(frame.circuit.edges)).edges)

    const settle = () => {
      setNodes((current) => current
        .filter((node) => !node.className?.includes('demo-leave'))
        .map((node) => (targetPositions.has(node.id) ? { ...node, position: targetPositions.get(node.id)! } : node)))
      setEdges((current) => current.filter((edge) => !edge.className?.includes('demo-edge-leave')))
    }

    const moves = merged.moves
    if (moves.length === 0 || reducedMotion()) {
      leaveTimer.current = setTimeout(settle, reducedMotion() ? 0 : LEAVE_MS)
      return () => {
        if (leaveTimer.current) clearTimeout(leaveTimer.current)
      }
    }
    const controls = animate(0, 1, {
      duration: MOVE_MS / 1000,
      ease: 'linear',
      onUpdate: (t) => {
        const positions = interpolate(moves, t)
        setNodes((current) => current.map((node) => (positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node)))
      },
      onComplete: settle,
    })
    animation.current = {
      stop: () => controls.stop(),
      finish: () => {
        controls.stop()
        settle()
      },
    }
    return () => controls.stop()
  }, [frame, setNodes, setEdges])

  // 打开时等元件测量好再适配一次；之后只在「适应画布」时适配
  const fitted = useRef(false)
  useEffect(() => {
    if (!initialized || fitted.current) return
    fitted.current = true
    fit()
  }, [initialized, fit])
  useEffect(() => {
    if (fitSignal > 0) fit(400)
  }, [fitSignal, fit])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => fit(), 200)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [fit])

  return (
    <ReactFlow
      id="case-demo"
      className={styles.demoFlow}
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      disableKeyboardA11y
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      panActivationKeyCode={null}
      zoomOnDoubleClick={false}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} color="#1e293b" />
      {children}
    </ReactFlow>
  )
}
