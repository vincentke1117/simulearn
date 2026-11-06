import type { InternalNode } from '@xyflow/react'

export type Point = { x: number; y: number }

/** 端子中心（流坐标）：positionAbsolute + 句柄相对节点左上角的位置（xyflow 测量时已经除过 zoom） */
export function terminalPoint(node: InternalNode | undefined, handleId: string): Point | null {
  if (!node) return null
  const bounds = node.internals.handleBounds?.source?.find((handle) => handle.id === handleId)
    ?? node.internals.handleBounds?.target?.find((handle) => handle.id === handleId)
  if (!bounds) return null
  const origin = node.internals.positionAbsolute
  return { x: origin.x + bounds.x + bounds.width / 2, y: origin.y + bounds.y + bounds.height / 2 }
}
