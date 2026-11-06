import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, RotateCcw, X } from 'lucide-react'

import styles from './demo.module.css'

/** 演示底部的步骤条：标题、讲解（children）、进度点、上一步 / 下一步 / 从头开始 / 适应画布 / 退出 */
export function DemoBar({ title, stepTitle, index, count, onPrev, onNext, onRestart, onFit, onClose, failedSteps, toolbar, children }: {
  title: string
  stepTitle: string
  index: number
  count: number
  onPrev: () => void
  onNext: () => void
  onRestart: () => void
  onFit: () => void
  onClose: () => void
  failedSteps?: boolean[]
  toolbar?: ReactNode
  children?: ReactNode
}) {
  const button = 'flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-[15px] text-slate-200 hover:border-blue-400 hover:text-blue-200 disabled:opacity-40 disabled:hover:border-slate-600 disabled:hover:text-slate-200'
  return (
    <div className={styles.bar}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[15px] text-slate-400">{title}</span>
        <div className="flex items-center gap-1.5" aria-label={`第 ${index + 1} 步，共 ${count} 步`}>
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rounded-full ${i === index ? 'bg-amber-400' : i < index ? 'bg-slate-400' : 'bg-slate-700'} ${failedSteps?.[i] ? 'ring-2 ring-red-500' : ''}`}
            />
          ))}
        </div>
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <button className={button} onClick={onFit} title="把整张电路放回视野里">
            <Maximize2 className="h-4 w-4" />适应画布
          </button>
          <button className={button} onClick={onRestart} disabled={index === 0}>
            <RotateCcw className="h-4 w-4" />从头开始
          </button>
          <button className={button} onClick={onPrev} disabled={index === 0}>
            <ChevronLeft className="h-4 w-4" />上一步
          </button>
          <button className={`${button} border-amber-500/70 text-amber-100`} onClick={onNext} disabled={index === count - 1}>
            下一步<ChevronRight className="h-4 w-4" />
          </button>
          <button className={button} onClick={onClose} title="退出演示，回到自己的电路（Esc）">
            <X className="h-4 w-4" />退出演示
          </button>
        </div>
      </div>
      <h2 className={`${styles.stepTitle} mt-2`}>{stepTitle}</h2>
      {children}
    </div>
  )
}
