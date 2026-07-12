import { useMemo } from 'react'

import { formatEngineering, formatPhasor } from './format'

export interface Phasor {
  id: string
  magnitude: number
  phaseDeg: number
}

export interface PhasorDiagramProps {
  phasors: Phasor[]
  unit: string
  /** 画布边长（px） */
  size?: number
}

// 与画布元件配色同源的工程色板
const PHASOR_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
]

const RING_FRACTIONS = [0.25, 0.5, 0.75, 1]
const ANGLE_TICKS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]

/**
 * 复平面相量图：以峰值幅值为半径、相角为极角画箭头。
 * 交流电路教学的核心视觉——学生要能一眼看出"电流超前电压 45°"。
 */
export function PhasorDiagram({ phasors, unit, size = 340 }: PhasorDiagramProps) {
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 34

  const drawable = useMemo(
    () => phasors.filter((p) => Number.isFinite(p.magnitude) && Math.abs(p.magnitude) > 0),
    [phasors],
  )
  const maxMagnitude = useMemo(
    () => drawable.reduce((max, p) => Math.max(max, Math.abs(p.magnitude)), 0),
    [drawable],
  )

  if (maxMagnitude === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/40 text-xs text-slate-500">
        全部相量幅值为 0，无可绘制的相量
      </div>
    )
  }

  const project = (magnitude: number, phaseDeg: number) => {
    const r = (Math.abs(magnitude) / maxMagnitude) * radius
    const theta = (phaseDeg * Math.PI) / 180
    return { x: cx + r * Math.cos(theta), y: cy - r * Math.sin(theta) }
  }

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="shrink-0 rounded-lg border border-slate-700 bg-slate-900/60"
        role="img"
        aria-label="相量图"
      >
        {/* 等幅值圆环 */}
        {RING_FRACTIONS.map((fraction) => (
          <circle
            key={fraction}
            cx={cx}
            cy={cy}
            r={radius * fraction}
            fill="none"
            stroke="#334155"
            strokeWidth={fraction === 1 ? 1.2 : 0.6}
            strokeDasharray={fraction === 1 ? undefined : '3 3'}
          />
        ))}

        {/* 角度刻度 */}
        {ANGLE_TICKS.map((angle) => {
          const outer = project(maxMagnitude, angle)
          const label = project(maxMagnitude * 1.13, angle)
          return (
            <g key={angle}>
              <line x1={cx} y1={cy} x2={outer.x} y2={outer.y} stroke="#1e293b" strokeWidth={0.6} />
              <text
                x={label.x}
                y={label.y}
                fontSize={9}
                fill="#475569"
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="ui-monospace, monospace"
              >
                {angle}°
              </text>
            </g>
          )
        })}

        {/* 实轴 / 虚轴 */}
        <line x1={cx - radius} y1={cy} x2={cx + radius} y2={cy} stroke="#475569" strokeWidth={1} />
        <line x1={cx} y1={cy - radius} x2={cx} y2={cy + radius} stroke="#475569" strokeWidth={1} />
        <text x={cx + radius - 2} y={cy - 6} fontSize={10} fill="#64748b" textAnchor="end" fontFamily="ui-monospace, monospace">
          Re
        </text>
        <text x={cx + 6} y={cy - radius + 8} fontSize={10} fill="#64748b" fontFamily="ui-monospace, monospace">
          Im
        </text>

        {/* 满量程标注 */}
        <text x={cx + 4} y={cy + radius - 4} fontSize={9} fill="#64748b" fontFamily="ui-monospace, monospace">
          满量程 {formatEngineering(maxMagnitude, unit)}（峰值）
        </text>

        {/* 相量箭头 */}
        {drawable.map((phasor, index) => {
          const color = PHASOR_COLORS[index % PHASOR_COLORS.length]
          const tip = project(phasor.magnitude, phasor.phaseDeg)
          const dx = tip.x - cx
          const dy = tip.y - cy
          const length = Math.hypot(dx, dy) || 1
          const ux = dx / length
          const uy = dy / length
          const head = 9
          const halfWidth = 4
          const baseX = tip.x - ux * head
          const baseY = tip.y - uy * head
          const arrow = [
            `${tip.x},${tip.y}`,
            `${baseX - uy * halfWidth},${baseY + ux * halfWidth}`,
            `${baseX + uy * halfWidth},${baseY - ux * halfWidth}`,
          ].join(' ')

          return (
            <g key={phasor.id}>
              <line x1={cx} y1={cy} x2={baseX} y2={baseY} stroke={color} strokeWidth={2} strokeLinecap="round" />
              <polygon points={arrow} fill={color} />
              <text
                x={tip.x + ux * 12}
                y={tip.y + uy * 12}
                fontSize={10}
                fill={color}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="ui-monospace, monospace"
              >
                {phasor.id}
              </text>
            </g>
          )
        })}

        <circle cx={cx} cy={cy} r={2.5} fill="#94a3b8" />
      </svg>

      {/* 图例：直接给可读数值，学生不用去量角度 */}
      <ul className="min-w-0 flex-1 space-y-1.5">
        {phasors.map((phasor) => {
          const drawIndex = drawable.findIndex((p) => p.id === phasor.id)
          const color = drawIndex >= 0 ? PHASOR_COLORS[drawIndex % PHASOR_COLORS.length] : '#475569'
          return (
            <li key={phasor.id} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <span className="w-16 shrink-0 truncate text-slate-400">{phasor.id}</span>
              <span className="font-mono text-slate-200">
                {formatPhasor(phasor.magnitude, phasor.phaseDeg, unit)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
