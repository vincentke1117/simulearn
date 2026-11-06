import { lazy, Suspense, useRef, useState } from 'react'
import { BookOpen, ChevronUp, PlayCircle } from 'lucide-react'

import { formatEngineering } from '@/simulation/format'
import { shortMethodLabel } from '@/workspace/methodLabels'
import type { CaseDemoRef } from './demo/types'
import type { CaseCheck, TeachingCase } from './types'

// 演示播放器只在点「演示」时加载，案例库首屏不背它
const DemoPlayer = lazy(() => import('./demo/DemoPlayer'))

function checkValue(check: CaseCheck): string {
  return `${formatEngineering(check.expect, check.unit)}${check.rms ? '（有效值）' : ''}`
}

/**
 * 案例说明卡：浮在画布左上角，可以收起。「教材结果」给学生对照仿真读数用，
 * 和测试里核对内核的是同一组数（cases.e2e.test.ts），不会出现说明和实际算不一致。
 */
export function CaseGuide({ item }: { item: TeachingCase }) {
  const [open, setOpen] = useState(true)
  const [demo, setDemo] = useState<CaseDemoRef | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const closeDemo = () => {
    setDemo(null)
    // 焦点还给打开演示的按钮（#root 的 inert 在播放器卸载时撤掉）
    setTimeout(() => opener.current?.focus(), 0)
  }
  const player = demo && (
    <Suspense fallback={null}>
      <DemoPlayer item={item} demo={demo} onClose={closeDemo} />
    </Suspense>
  )

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/95 px-3 py-1.5 text-xs text-slate-200 shadow-lg hover:text-blue-300"
      >
        <BookOpen className="h-3.5 w-3.5" />
        案例说明
      </button>
    )
  }

  return (
    <aside
      aria-label="案例说明"
      className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-24px)] w-[340px] max-w-[calc(100%-24px)] flex-col rounded-xl border border-slate-600 bg-slate-800/95 text-slate-200 shadow-2xl"
    >
      <div className="flex items-start gap-2 border-b border-slate-700 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-slate-400">
            第 {item.chapter} 章 {item.chapterTitle} · {item.source} · {shortMethodLabel(item.preset.method)}
          </div>
          <h2 className="mt-0.5 text-sm font-semibold leading-snug text-slate-100">{item.title}</h2>
        </div>
        <button onClick={() => setOpen(false)} className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-100" title="收起说明">
          <ChevronUp className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 overflow-y-auto px-4 py-3 text-xs leading-relaxed">
        <p className="text-slate-300">{item.summary}</p>
        {item.demos && item.demos.length > 0 && (
          <section>
            <h3 className="mb-1 font-semibold text-slate-100">课堂演示</h3>
            <ul className="space-y-1.5">
              {item.demos.map((entry) => (
                <li key={entry.id}>
                  <button
                    ref={(element) => {
                      if (demo?.id === entry.id) opener.current = element
                    }}
                    onClick={(event) => {
                      opener.current = event.currentTarget
                      setDemo(entry)
                    }}
                    className="flex w-full items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-left text-amber-100 hover:border-amber-400"
                  >
                    <PlayCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <span className="font-medium">{entry.title}</span>
                      {entry.summary && <span className="block text-[11px] text-amber-200/70">{entry.summary}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h3 className="mb-1 font-semibold text-slate-100">动手试试</h3>
          <ol className="list-decimal space-y-1 pl-4 text-slate-300">
            {item.tryIt.map((text) => <li key={text}>{text}</li>)}
          </ol>
        </section>
        <section>
          <h3 className="mb-1 font-semibold text-slate-100">教材结果（运行后对照）</h3>
          <ul className="space-y-1">
            {item.checks.map((check) => (
              <li key={check.label} className="flex items-baseline justify-between gap-3">
                <span className="text-slate-300">{check.label}</span>
                <span className="shrink-0 font-mono text-emerald-300" title={check.fromBook ? '教材给出的数' : '教材只列了方程，这个数按教材数据算出'}>
                  {checkValue(check)}{check.fromBook ? '' : '*'}
                </span>
              </li>
            ))}
          </ul>
          {item.checks.some((check) => !check.fromBook) && (
            <p className="mt-1 text-[11px] text-slate-500">* 教材只列了方程，这个数按教材的数据算出。</p>
          )}
        </section>
        {item.notes && item.notes.length > 0 && (
          <section>
            <h3 className="mb-1 font-semibold text-slate-100">和教材的差别</h3>
            <ul className="list-disc space-y-1 pl-4 text-slate-400">
              {item.notes.map((text) => <li key={text}>{text}</li>)}
            </ul>
          </section>
        )}
        <p className="text-[11px] text-slate-500">电路结构固定，点元件可以改参数；改乱了用上方「恢复初始电路」。</p>
      </div>
      {player}
    </aside>
  )
}
