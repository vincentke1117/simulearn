import { useMemo, useState } from 'react'

import { applyOverlay } from '@/simulation/mapping'
import type { SimulationPayload } from '@/types/circuit'
import { pickBranchCurrents, pickNodeVoltages } from '@/workspace/circuitWorkspaceHelpers'
import { DemoCanvas, type DemoFrame } from './DemoCanvas'
import { demoCircuit, evaluateValue, evaluateValues, fillText, formatValue, stepProject, stepRequest, tableRequests } from './demoPayload'
import { DemoBar } from './DemoBar'
import { useStepKeys } from './useStepKeys'
import type { StepsDemo } from './types'
import { useDemoResults, type DemoResult } from './useDemoResults'
import styles from './demo.module.css'

const OVERLAY_METHODS = new Set(['node_voltage', 'branch_current', 'mesh_current', 'dc_op'])

/** 「上一步 / 下一步」逐帧演示（等效变换类）：每帧一张电路，保留的元件平滑挪位，读数由内核现算 */
export function StepsStage({ script, onClose }: { script: StepsDemo; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [fitSignal, setFitSignal] = useState(0)
  const last = script.steps.length - 1
  const go = (next: number) => setIndex(Math.max(0, Math.min(last, next)))
  useStepKeys({ onPrev: () => go(index - 1), onNext: () => go(index + 1), onClose })

  const requests = useMemo(() => script.steps.flatMap((_, i) => {
    const list: Array<{ key: string; build: NonNullable<ReturnType<typeof stepRequest>> }> = []
    const build = stepRequest(script, i)
    if (build) list.push({ key: `step:${i}`, build })
    tableRequests(script, i).forEach((tableBuild, row) => list.push({ key: `table:${i}:${row}`, build: tableBuild }))
    return list
  }), [script])
  const { results, retry } = useDemoResults(requests)

  const allPositions = useMemo(() => script.steps.flatMap((step, i) => {
    const nodes = stepProject(script, i).nodes
    const anchors = new Map(nodes.map((node) => [node.id, node.position]))
    const notes = (step.notes ?? []).map((note) => {
      const anchor = note.anchor ? anchors.get(note.anchor) : undefined
      return anchor ? { x: anchor.x + (note.dx ?? 0), y: anchor.y + (note.dy ?? -60) } : { x: note.x ?? 0, y: note.y ?? 0 }
    })
    return [...nodes.map((node) => node.position), ...notes]
  }), [script])

  const step = script.steps[index]
  const result: DemoResult | undefined = results[`step:${index}`]
  const outcomes = result?.status === 'ok' ? evaluateValues(step.values ?? [], result.payload, result.data) : undefined

  const frame = useMemo<DemoFrame>(() => {
    const circuit = demoCircuit(stepProject(script, index))
    const ownCircuit = step.compute && (step.compute.from === undefined || step.compute.from === index)
    const decorate = ownCircuit && OVERLAY_METHODS.has(step.compute!.method) && result?.status === 'ok'
      ? (nodes: typeof circuit.nodes) => {
        const voltages = pickNodeVoltages(result.data as never)
        if (!voltages) return nodes
        return applyOverlay(nodes, (result.payload as SimulationPayload).nets, voltages, 'node', pickBranchCurrents(result.data as never) ?? undefined, true)
      }
      : undefined
    return { circuit, highlight: step.highlight, dim: step.dim, notes: step.notes, hideHandleLabels: step.hideHandleLabels, decorate }
  }, [script, index, step, result])

  const pending = result?.status === 'loading'
  return (
    <>
      <div className={styles.stage}>
        <DemoCanvas frame={frame} allPositions={allPositions} fitSignal={fitSignal} />
      </div>
      <DemoBar
        title={script.title}
        stepTitle={step.title}
        index={index}
        count={script.steps.length}
        onPrev={() => go(index - 1)}
        onNext={() => go(index + 1)}
        onRestart={() => go(0)}
        onFit={() => setFitSignal((value) => value + 1)}
        onClose={onClose}
        failedSteps={script.steps.map((_, i) => results[`step:${i}`]?.status === 'error')}
      >
        <p className={styles.stepText}>{fillText(step.text, step.values?.length ? outcomes : [])}</p>
        {step.values && step.values.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[17px]">
            {pending && <span className="text-slate-400">计算中…</span>}
            {result?.status === 'error' && (
              <span className="text-red-300">
                这一步没算出来：{result.message}
                <button className="ml-2 underline" onClick={retry}>重算</button>
              </span>
            )}
            {outcomes?.map((outcome) => (
              <span key={outcome.value.key}>
                <span className="text-slate-400">{outcome.value.label}：</span>
                <span className="font-mono text-emerald-300">{outcome.actual === undefined ? outcome.reason : formatValue(outcome.value, outcome.actual)}</span>
              </span>
            ))}
          </div>
        )}
        {step.table && <SweepTable script={script} index={index} results={results} />}
      </DemoBar>
    </>
  )
}

function SweepTable({ script, index, results }: { script: StepsDemo; index: number; results: Record<string, DemoResult> }) {
  const table = script.steps[index].table!
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="text-[16px]">
        <thead>
          <tr className="text-slate-400">
            <th className="pr-6 text-left font-normal">{table.param.label}</th>
            {table.columns.map((column) => (
              <th key={column.label} className="pr-6 text-left font-normal">{column.label}</th>
            ))}
            {table.columns.some((column) => column.book) && <th className="text-left font-normal text-slate-500">教材</th>}
          </tr>
        </thead>
        <tbody className="font-mono">
          {table.values.map((value, row) => {
            const result = results[`table:${index}:${row}`]
            return (
              <tr key={value}>
                <td className="pr-6">{value} {table.param.unit}</td>
                {table.columns.map((column) => {
                  if (result?.status !== 'ok') return <td key={column.label} className="pr-6 text-slate-500">{result?.status === 'error' ? '—' : '…'}</td>
                  const outcome = evaluateValue({ path: column.path }, result.payload, result.data)
                  return (
                    <td key={column.label} className="pr-6 text-emerald-300">
                      {outcome.actual === undefined ? '—' : formatValue({ unit: column.unit, digits: column.digits }, outcome.actual)}
                    </td>
                  )
                })}
                {table.columns.some((column) => column.book) && (
                  <td className="text-slate-400">
                    {table.columns.map((column) => (column.book ? formatValue({ unit: column.unit, digits: column.digits }, column.book[row]) : '')).join(' / ')}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {table.caption && <p className="mt-1 text-[15px] text-slate-400">{table.caption}</p>}
    </div>
  )
}
