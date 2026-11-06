import { useMemo, useState } from 'react'

import { buildSimulationPayload } from '@/simulation/payload'
import type { SimulationPayload } from '@/types/circuit'
import { initialSimulationSettings } from '@/workspace/circuitWorkspaceHelpers'
import { caseCircuit } from '../library'
import type { TeachingCase } from '../types'
import { DemoBar } from './DemoBar'
import { useStepKeys } from './useStepKeys'
import { DemoCanvas, type DemoFrame } from './DemoCanvas'
import { formatNumber, loopTerms, termTexts, type KvlDirection, type KvlTerm } from './kvl'
import { KvlOverlay } from './KvlOverlay'
import type { KvlDemo } from './types'
import { useDemoResults } from './useDemoResults'
import styles from './demo.module.css'

const SIGN_NAME: Record<string, string> = { p: '+', pos: '+', n: '−', neg: '−' }

function explain(term: KvlTerm, symbol: string): string {
  const same = term.sign > 0
  const base = `走过 ${term.label}：从 ${SIGN_NAME[term.enter] ?? term.enter} 端进、${SIGN_NAME[term.exit] ?? term.exit} 端出，参考方向与绕行方向${same ? '一致' : '相反'}，记 ${symbol}。`
  if (term.u < 0) return `${base}读数 u = ${formatNumber(term.u)} V 是负的：项前的符号只看参考方向，括号里的负号来自读数，两者不要混。`
  return base
}

/**
 * KVL 与参考方向：先讲参考方向、读数与实际方向（intro），再选回路和绕行方向（顺时针、逆时针都允许），
 * 每点一次「下一步」走过一个元件，方程栏同时出现符号项、欧姆定律式、代入值，走完一圈 Σu = 0，最后给教材形式。
 */
export function KvlStage({ script, item, onClose }: { script: KvlDemo; item: TeachingCase; onClose: () => void }) {
  const circuit = useMemo(() => caseCircuit(item), [item])
  const build = useMemo(
    () => buildSimulationPayload(circuit.nodes, circuit.edges, { ...initialSimulationSettings, method: script.method }),
    [circuit, script.method],
  )
  const requests = useMemo(() => [{ key: 'kvl', build }], [build])
  const { results, retry } = useDemoResults(requests)
  const result = results.kvl
  const data = result?.status === 'ok' ? result.data as { node_voltages?: Record<string, number>; branch_currents?: Record<string, number> } : null
  const labels = useMemo(() => Object.fromEntries(circuit.nodes.map((node) => [node.id, node.data.label])), [circuit])

  const [loopId, setLoopId] = useState(script.loops[0]?.id)
  const [direction, setDirection] = useState<KvlDirection>('cw')
  const loop = script.loops.find((entry) => entry.id === loopId) ?? script.loops[0]
  // 步序：讲解步（intro）→ 回路起点（还没走）→ 每走过一个元件一步 → Σu = 0 → 教材形式（有才算）
  const introCount = script.intro.length
  const sumIndex = introCount + loop.elements.length + 1
  const textbookIndex = sumIndex + 1
  const total = sumIndex + 1 + (loop.textbook?.length ? 1 : 0)
  const [index, setIndex] = useState(0)
  const go = (next: number) => setIndex(Math.max(0, Math.min(total - 1, next)))
  useStepKeys({ onPrev: () => go(index - 1), onNext: () => go(index + 1), onClose })
  const [fitSignal, setFitSignal] = useState(0)

  const terms = useMemo(
    () => (data?.node_voltages && build.payload ? loopTerms(loop, direction, build.payload as SimulationPayload, data.node_voltages, labels) : []),
    [data, build, loop, direction, labels],
  )
  const inLoop = index >= introCount
  const traversed = inLoop ? Math.min(loop.elements.length, index - introCount) : 0
  const current = traversed > 0 && index < sumIndex ? terms[traversed - 1] : undefined

  const frame = useMemo<DemoFrame>(() => ({
    circuit,
    highlight: current ? [current.id] : [],
    hideHandleLabels: circuit.nodes.map((node) => node.id),
  }), [circuit, current])
  const allPositions = useMemo(() => circuit.nodes.map((node) => node.position), [circuit])

  const choose = (id: string, dir: KvlDirection) => {
    setLoopId(id)
    setDirection(dir)
    setIndex(introCount)
  }
  const texts = terms.map((term) => termTexts(term, circuit.nodes, script.branches))
  const done = texts.slice(0, traversed)
  const sum = terms.reduce((acc, term) => acc + term.contribution, 0)

  const directionName = direction === 'cw' ? '顺时针' : '逆时针'
  const stepTitle = !inLoop
    ? script.intro[index].title
    : index >= textbookIndex
      ? `${loop.name}：写成教材的形式`
      : index >= sumIndex
        ? `${loop.name}（${directionName}）：走完一圈，Σu = 0`
        : `${loop.name}，${directionName}绕行，从${loop.start}出发${traversed ? `（第 ${traversed} 个元件）` : ''}`

  const chip = (active: boolean) => `rounded-full border px-3 py-1 text-[15px] ${active ? 'border-amber-400 bg-amber-500/15 text-amber-100' : 'border-slate-600 text-slate-300 hover:border-slate-400'}`
  return (
    <>
      <div className={styles.stage}>
        <DemoCanvas frame={frame} allPositions={allPositions} fitSignal={fitSignal}>
          <KvlOverlay
            nodes={circuit.nodes}
            branches={script.branches}
            currents={data?.branch_currents ?? null}
            showValues={index >= 1}
            showActual={!inLoop && Boolean(script.intro[index]?.showActual)}
            terms={inLoop ? terms : []}
            traversed={traversed}
            direction={inLoop ? direction : null}
            loopElements={inLoop ? loop.elements.map((element) => element.id) : []}
          />
        </DemoCanvas>
      </div>
      <DemoBar
        title={script.title}
        stepTitle={stepTitle}
        index={index}
        count={total}
        onPrev={() => go(index - 1)}
        onNext={() => go(index + 1)}
        onRestart={() => go(0)}
        onFit={() => setFitSignal((value) => value + 1)}
        onClose={onClose}
        toolbar={(
          <div className="flex flex-wrap items-center gap-2">
            {script.loops.map((entry) => (
              <button key={entry.id} className={chip(inLoop && entry.id === loop.id)} onClick={() => choose(entry.id, direction)}>{entry.name}</button>
            ))}
            <span className="mx-1 text-slate-600">|</span>
            <button className={chip(inLoop && direction === 'cw')} onClick={() => choose(loop.id, 'cw')}>顺时针</button>
            <button className={chip(inLoop && direction === 'ccw')} onClick={() => choose(loop.id, 'ccw')}>逆时针</button>
          </div>
        )}
      >
        {result?.status === 'error' && (
          <p className="mt-1 text-red-300">读数没算出来：{result.message}<button className="ml-2 underline" onClick={retry}>重算</button></p>
        )}
        {!inLoop && <p className={styles.stepText}>{script.intro[index].text}</p>}
        {inLoop && (
          <div className="mt-1 space-y-1">
            <p className={styles.stepText}>
              {traversed === 0
                ? `点「下一步」沿${directionName}方向逐个走过元件。规则只有一条：电压参考方向（+ → −）与绕行方向一致记 +u，相反记 −u。${loop.note ?? ''}`
                : index >= sumIndex
                  ? `回到起点，电位又回到 0：沿任一闭合回路，各元件电压按参考方向取正负之和为 0。${direction === 'ccw' ? '逆时针的方程就是顺时针那个乘以 −1。' : '换成逆时针试试：每一项都变号。'}`
                  : current && explain(current, done[done.length - 1].symbol)}
            </p>
            {traversed > 0 && (
              <div className={styles.equation}>
                <div>{done.map((text) => text.symbol).join(' ')}{index >= sumIndex ? ' = 0' : ''}</div>
                {done.some((text) => text.law) && <div className="text-slate-400">{done.map((text) => text.law).filter(Boolean).join('，')}</div>}
                <div>
                  {done.map((text) => text.substituted).join(' ')}
                  {index >= sumIndex ? ` = ${formatNumber(sum)}` : ''}
                  {index < sumIndex && <span className="ml-3 text-slate-500">（单位 V）</span>}
                </div>
              </div>
            )}
            {index >= textbookIndex && loop.textbook?.map((line) => <div key={line} className={`${styles.equation} text-amber-200`}>{line}</div>)}
          </div>
        )}
      </DemoBar>
    </>
  )
}
