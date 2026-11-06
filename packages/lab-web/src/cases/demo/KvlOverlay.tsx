import { useStore, useStoreApi, ViewportPortal, type InternalNode, type Node } from '@xyflow/react'
import { motion } from 'framer-motion'

import type { CircuitNodeData } from '@/types/circuit'
import { terminalPoint, type Point } from './geometry'
import { formatNumber, type KvlDirection, type KvlTerm } from './kvl'
import type { KvlBranch } from './types'

function centerOf(node: InternalNode | undefined): Point | null {
  if (!node) return null
  const origin = node.internals.positionAbsolute
  return { x: origin.x + (node.measured.width ?? 160) / 2, y: origin.y + (node.measured.height ?? 100) / 2 }
}

/** 把点从元件中心往外推一点（标在端子外侧，不压在端子上） */
function outward(point: Point, center: Point, distance: number): Point {
  const dx = point.x - center.x
  const dy = point.y - center.y
  const length = Math.hypot(dx, dy) || 1
  return { x: point.x + (dx / length) * distance, y: point.y + (dy / length) * distance }
}

const COLORS = { reference: '#38bdf8', actual: '#fb7185', polarity: '#fde68a', loop: '#fbbf24' }

function Arrow({ from, to, color, label, dashed, labelLeft }: { from: Point; to: Point; color: string; label: string; dashed?: boolean; labelLeft?: boolean }) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const head = (sign: number) => `${to.x - 12 * Math.cos(angle + sign * 0.45)},${to.y - 12 * Math.sin(angle + sign * 0.45)}`
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  return (
    <g>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={3} strokeDasharray={dashed ? '6 5' : undefined} />
      <polygon points={`${to.x},${to.y} ${head(1)} ${head(-1)}`} fill={color} />
      <text x={labelLeft ? mid.x - 10 : mid.x + 10} y={mid.y - 8} fill={color} fontSize={16} fontWeight={600} textAnchor={labelLeft ? 'end' : 'start'}>{label}</text>
    </g>
  )
}

/**
 * KVL 叠加层（画在 ViewportPortal 里，跟画布一起缩放平移，不挡点击）：
 * - 每个元件两端的电压参考极性 + / −（电阻按所在支路电流的关联方向，电源按自身极性）；
 * - 每条支路一个电流参考箭头（沿 ref 元件 p→n）；showActual 时读数为负的支路再画一个反向的「实际方向」箭头；
 * - 已走过的绕行路径、绕行标记（圆点）和沿途电位；回路中央的绕行方向环形箭头。
 */
export function KvlOverlay({ nodes, branches, currents, showValues, showActual, terms, traversed, direction, loopElements }: {
  nodes: Node<CircuitNodeData>[]
  branches: KvlBranch[]
  currents: Record<string, number> | null
  showValues: boolean
  showActual: boolean
  terms: KvlTerm[]
  traversed: number
  direction: KvlDirection | null
  loopElements: string[]
}) {
  // nodeLookup 是原地更新的同一个 Map：只订阅它的话，元件测量完（端子坐标才有）也不会重绘。
  // 订阅节点数组（测量结果经 onNodesChange 写回时它会换新），再从 store 里取 lookup
  useStore((state) => state.nodes)
  const lookup = useStoreApi().getState().nodeLookup
  const marks: Array<{ point: Point; text: string }> = []
  for (const node of nodes) {
    const internal = lookup.get(node.id)
    const center = centerOf(internal)
    if (!internal || !center) continue
    const pair = node.type?.startsWith('vsource') || node.type?.startsWith('isource') ? ['pos', 'neg'] : ['p', 'n']
    if (node.type?.startsWith('isource') || node.type === 'ground' || node.type?.endsWith('probe')) continue
    const plus = terminalPoint(internal, pair[0])
    const minus = terminalPoint(internal, pair[1])
    if (plus) marks.push({ point: outward(plus, center, 18), text: '+' })
    if (minus) marks.push({ point: outward(minus, center, 18), text: '−' })
  }

  const arrows = branches.flatMap((branch) => {
    const internal = lookup.get(branch.ref)
    const p = terminalPoint(internal, 'p')
    const n = terminalPoint(internal, 'n')
    if (!p || !n) return []
    // 箭头画在元件卡片外侧：沿 p→n 方向的垂线偏开约半个卡片宽再多一点，不压在卡片上
    const length = Math.hypot(n.x - p.x, n.y - p.y) || 1
    const off = { x: -((n.y - p.y) / length) * 96, y: ((n.x - p.x) / length) * 96 }
    const from = { x: p.x + off.x + (n.x - p.x) * 0.2, y: p.y + off.y + (n.y - p.y) * 0.2 }
    const to = { x: p.x + off.x + (n.x - p.x) * 0.8, y: p.y + off.y + (n.y - p.y) * 0.8 }
    const value = currents?.[branch.ref]
    const label = showValues && value !== undefined ? `${branch.name} = ${formatNumber(value)} A` : branch.name
    // 箭头偏到卡片左边时，读数往左写，不然会压在卡片标题上
    const labelLeft = off.x < -1
    const list = [<Arrow key={`${branch.name}-ref`} from={from} to={to} color={COLORS.reference} label={label} labelLeft={labelLeft} />]
    if (showActual && value !== undefined && value < 0) {
      // 实际方向箭头再往外错开一个参考读数（如「Id = −1 A」）的宽度，竖线不穿过那行字
      const shift = { x: off.x * 1.15, y: off.y * 1.15 }
      list.push(
        <Arrow
          key={`${branch.name}-actual`}
          from={{ x: to.x + shift.x, y: to.y + shift.y }}
          to={{ x: from.x + shift.x, y: from.y + shift.y }}
          color={COLORS.actual}
          label={`实际 ${formatNumber(-value)} A`}
          labelLeft={labelLeft}
          dashed
        />,
      )
    }
    return list
  })

  // 绕行路径：每个已走过元件的进 → 出，以及元件之间的连接
  const path: Point[] = []
  const potentials: Array<{ point: Point; text: string }> = []
  terms.slice(0, traversed).forEach((term, i) => {
    const internal = lookup.get(term.id)
    const center = centerOf(internal)
    const enter = terminalPoint(internal, term.enter)
    const exit = terminalPoint(internal, term.exit)
    if (!enter || !exit || !center) return
    // 元件之间先竖后横走一个直角，贴着导线，不斜穿电路
    const previous = path[path.length - 1]
    if (previous && previous.x !== enter.x && previous.y !== enter.y) path.push({ x: previous.x, y: enter.y })
    // 电位标在端子外侧（和极性符号同一方向、再往外一点），不压在元件标题上
    if (i === 0) potentials.push({ point: outward(enter, center, 40), text: `${formatNumber(term.before)} V` })
    path.push(enter, exit)
    potentials.push({ point: outward(exit, center, 40), text: `${formatNumber(term.after)} V` })
  })
  const marker = path.length > 0 ? path[path.length - 1] : (() => {
    const first = terms[0]
    return first ? terminalPoint(lookup.get(first.id), first.enter) : null
  })()

  const loopCenters = loopElements.map((id) => centerOf(lookup.get(id))).filter((p): p is Point => p !== null)
  const loopCenter = loopCenters.length
    ? { x: loopCenters.reduce((sum, p) => sum + p.x, 0) / loopCenters.length, y: loopCenters.reduce((sum, p) => sum + p.y, 0) / loopCenters.length }
    : null

  return (
    <ViewportPortal>
      <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width={1} height={1}>
        {marks.map((mark, i) => (
          <text key={i} x={mark.point.x} y={mark.point.y} fill={COLORS.polarity} fontSize={22} fontWeight={700} textAnchor="middle" dominantBaseline="central">{mark.text}</text>
        ))}
        {arrows}
        {loopCenter && direction && (
          <g opacity={0.9}>
            <path
              d={direction === 'cw'
                ? `M ${loopCenter.x - 42} ${loopCenter.y} A 42 42 0 1 1 ${loopCenter.x} ${loopCenter.y + 42}`
                : `M ${loopCenter.x + 42} ${loopCenter.y} A 42 42 0 1 0 ${loopCenter.x} ${loopCenter.y + 42}`}
              fill="none" stroke={COLORS.loop} strokeWidth={3} strokeDasharray="7 6"
            />
            <polygon
              points={direction === 'cw'
                ? `${loopCenter.x},${loopCenter.y + 42} ${loopCenter.x + 12},${loopCenter.y + 34} ${loopCenter.x + 10},${loopCenter.y + 50}`
                : `${loopCenter.x},${loopCenter.y + 42} ${loopCenter.x - 12},${loopCenter.y + 34} ${loopCenter.x - 10},${loopCenter.y + 50}`}
              fill={COLORS.loop}
            />
            <text x={loopCenter.x} y={loopCenter.y + 6} fill={COLORS.loop} fontSize={15} textAnchor="middle">绕行</text>
          </g>
        )}
        {path.length > 1 && (
          <polyline points={path.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={COLORS.loop} strokeWidth={4} strokeLinejoin="round" opacity={0.75} />
        )}
        {potentials.map((item, i) => (
          <text key={`v${i}`} x={item.point.x + 12} y={item.point.y} fill="#e2e8f0" fontSize={14} fontFamily="ui-monospace, monospace" dominantBaseline="central">{item.text}</text>
        ))}
        {marker && (
          // 首次挂载要给 initial：只给 animate 的话第一帧 cx / cy 是 undefined，浏览器会报属性错误
          <motion.circle r={9} fill={COLORS.loop} stroke="#0f172a" strokeWidth={2} initial={{ cx: marker.x, cy: marker.y }} animate={{ cx: marker.x, cy: marker.y }} transition={{ duration: 0.6, ease: 'easeInOut' }} />
        )}
      </svg>
    </ViewportPortal>
  )
}
