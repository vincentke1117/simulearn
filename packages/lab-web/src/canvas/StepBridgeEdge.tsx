import { memo, useMemo } from 'react'
import { BaseEdge, getSmoothStepPath, useStore, type EdgeProps, Position, type Edge } from '@xyflow/react'

type Segment = { x1: number; y1: number; x2: number; y2: number; o: 'h' | 'v' }

function computeStepSegments(sourceX: number, sourceY: number, targetX: number, targetY: number): Segment[] {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  if (Math.abs(dx) >= Math.abs(dy)) {
    // horizontal first
    const mid: [number, number] = [targetX, sourceY]
    return [
      { x1: sourceX, y1: sourceY, x2: mid[0], y2: mid[1], o: 'h' },
      { x1: mid[0], y1: mid[1], x2: targetX, y2: targetY, o: 'v' },
    ]
  } else {
    // vertical first
    const mid: [number, number] = [sourceX, targetY]
    return [
      { x1: sourceX, y1: sourceY, x2: mid[0], y2: mid[1], o: 'v' },
      { x1: mid[0], y1: mid[1], x2: targetX, y2: targetY, o: 'h' },
    ]
  }
}

function isBetween(v: number, a: number, b: number, eps = 0.5): boolean {
  const min = Math.min(a, b) - eps
  const max = Math.max(a, b) + eps
  return v >= min && v <= max
}

function intersect(segA: Segment, segB: Segment): { x: number; y: number; a: Segment } | null {
  // only consider orthogonal crossing; ignore colinear overlap
  if (segA.o === segB.o) return null
  const h = segA.o === 'h' ? segA : segB
  const v = segA.o === 'v' ? segA : segB
  const x = v.x1 // v.x is constant across segment
  const y = h.y1 // h.y is constant across segment
  if (isBetween(x, v.x1, v.x2) && isBetween(y, h.y1, h.y2)) {
    return { x, y, a: segA.o === 'h' ? segA : segB }
  }
  return null
}

export const StepBridgeEdge = memo((props: EdgeProps) => {
  const { id, label, labelStyle, markerEnd, markerStart, style, sourceX, sourceY, targetX, targetY } = props

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: props.sourcePosition as Position,
    targetPosition: props.targetPosition as Position,
  })

  // read all edges from store to check crossings (these include runtime positions)
  const allEdges = useStore((s) => s.edges)

  const bridges = useMemo(() => {
    const mine = computeStepSegments(sourceX, sourceY, targetX, targetY)
    const points: Array<{ x: number; y: number; o: 'h' | 'v' }> = []
    for (const e of allEdges) {
      if (!e || e.id === id) continue
      // avoid double drawing: only draw if our id is lexicographically greater
      if (String(id).localeCompare(String(e.id)) <= 0) continue
      // Access edge position data - these are runtime computed values
      const edge = e as Edge & { sourceX?: number; sourceY?: number; targetX?: number; targetY?: number }
      const sx = edge.sourceX
      const sy = edge.sourceY
      const tx = edge.targetX
      const ty = edge.targetY
      if (typeof sx !== 'number' || typeof sy !== 'number' || typeof tx !== 'number' || typeof ty !== 'number') continue
      const theirs = computeStepSegments(sx, sy, tx, ty)
      for (const a of mine) {
        for (const b of theirs) {
          const ip = intersect(a, b)
          if (!ip) continue
          // skip near endpoints of our segment to avoid breaking at handle positions
          const distA = Math.hypot(ip.x - a.x1, ip.y - a.y1)
          const distB = Math.hypot(ip.x - a.x2, ip.y - a.y2)
          if (distA < 12 || distB < 12) continue
          points.push({ x: ip.x, y: ip.y, o: a.o })
        }
      }
    }
    return points
  }, [id, allEdges, sourceX, sourceY, targetX, targetY])

  const baseStroke = (style && (style as React.CSSProperties).stroke) || '#94a3b8'
  const baseWidth = (style && (style as React.CSSProperties).strokeWidth as number) || 2
  const gapWidth = baseWidth + 3
  const hump = 8 // px

  // build overlay paths for gaps and humps
  const overlays = bridges.map((p) => {
    if (p.o === 'h') {
      const x1 = p.x - hump
      const x2 = p.x + hump
      const y = p.y
      // gap line (erase a section)
      const gapD = `M ${x1} ${y} L ${x2} ${y}`
      // bezier hump upwards
      const hx = hump / 2
      const humpD = `M ${x1} ${y} C ${x1} ${y}, ${p.x - hx} ${y - hump}, ${p.x} ${y - hump} C ${p.x + hx} ${y - hump}, ${x2} ${y}, ${x2} ${y}`
      return { gapD, humpD }
    } else {
      const y1 = p.y - hump
      const y2 = p.y + hump
      const x = p.x
      // gap line
      const gapD = `M ${x} ${y1} L ${x} ${y2}`
      // bezier hump to the right
      const hx = hump / 2
      const humpD = `M ${x} ${y1} C ${x} ${y1}, ${x + hump} ${p.y - hx}, ${x + hump} ${p.y} C ${x + hump} ${p.y + hx}, ${x} ${y2}, ${x} ${y2}`
      return { gapD, humpD }
    }
  })

  return (
    <g>
      <BaseEdge id={id} path={edgePath} label={label} labelX={labelX} labelY={labelY} labelStyle={labelStyle} style={style} markerEnd={markerEnd} markerStart={markerStart} />
      {overlays.map(({ gapD }, i) => (
        <path key={`gap-${i}`} d={gapD} stroke="#0f172a" strokeWidth={gapWidth} fill="none" strokeLinecap="round" />
      ))}
      {overlays.map(({ humpD }, i) => (
        <path key={`hump-${i}`} d={humpD} stroke={baseStroke} strokeWidth={baseWidth} fill="none" strokeLinecap="round" />
      ))}
    </g>
  )
})

export default StepBridgeEdge
