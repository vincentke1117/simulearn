import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ReactFlowProvider } from '@xyflow/react'

import type { TeachingCase } from '../types'
import { KvlStage } from './KvlStage'
import { loadDemoScript } from './loader'
import { StepsStage } from './StepsStage'
import type { CaseDemoRef, CaseDemoScript } from './types'
import styles from './demo.module.css'

/**
 * 案例演示播放器：挂到 document.body（fixed 盖满整个页面），打开期间整个应用（#root）设为 inert——
 * 不然结果面板（fixed z-50）会盖在演示上，顶栏的「运行」还点得到，Tab 能把焦点切回学生的画布，
 * 方向键会挪动学生自己的元件并写进草稿。
 * 自带 ReactFlowProvider：工作区外层也有一个，漏包的话演示的 setNodes 会作用到学生的电路上。
 */
export default function DemoPlayer({ item, demo, onClose }: { item: TeachingCase; demo: CaseDemoRef; onClose: () => void }) {
  const [script, setScript] = useState<CaseDemoScript | null>(null)
  const [error, setError] = useState<string | null>(null)
  const container = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    loadDemoScript(item.id, demo.id)
      .then((loaded) => alive && setScript(loaded))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      alive = false
    }
  }, [item.id, demo.id])

  useEffect(() => {
    const root = document.getElementById('root')
    const before = root?.inert ?? false
    if (root) root.inert = true
    // 嵌在知帆的 iframe 里：不主动拿焦点的话翻页键没反应
    container.current?.focus()
    return () => {
      if (root) root.inert = before
    }
  }, [])

  return createPortal(
    <div ref={container} className={styles.overlay} role="dialog" aria-modal="true" aria-label={`演示：${demo.title}`} tabIndex={-1}>
      <ReactFlowProvider>
        {error ? (
          <div className="m-auto max-w-lg space-y-3 text-center">
            <p className="text-red-300">演示没打开：{error}</p>
            <button className="rounded-lg border border-slate-600 px-4 py-2" onClick={onClose}>返回</button>
          </div>
        ) : !script ? (
          <div className="m-auto text-slate-400">正在打开演示…</div>
        ) : script.kind === 'steps' ? (
          <StepsStage script={script} onClose={onClose} />
        ) : (
          <KvlStage script={script} item={item} onClose={onClose} />
        )}
      </ReactFlowProvider>
    </div>,
    document.body,
  )
}
