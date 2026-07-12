import { useMemo, useState } from 'react'

import type { AcPhasorResult } from '@/types/circuit'
import {
  formatEngineering,
  formatFrequency,
  formatPhaseDeg,
  formatPhasor,
  formatPowerFactor,
  reactiveNature,
} from './format'
import { PhasorDiagram, type Phasor } from './PhasorDiagram'

export interface AcPhasorViewProps {
  result: AcPhasorResult
}

type PhasorTab = 'voltage' | 'current'

function toPhasors(
  magnitudes: Record<string, number>,
  phases: Record<string, number>,
): Phasor[] {
  return Object.keys(magnitudes)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ id, magnitude: magnitudes[id], phaseDeg: phases[id] ?? 0 }))
}

function PhasorTable({
  phasors,
  unit,
  columns,
}: {
  phasors: Phasor[]
  unit: string
  columns: [string, string, string]
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-800 text-slate-200">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{columns[0]}</th>
            <th className="px-3 py-2 text-right font-medium">{columns[1]}</th>
            <th className="px-3 py-2 text-right font-medium">{columns[2]}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50 bg-slate-900/50">
          {phasors.map((phasor) => (
            <tr key={phasor.id} className="transition-colors hover:bg-slate-800/50">
              <td className="px-3 py-2 text-slate-400">{phasor.id}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-200">
                {formatPhasor(phasor.magnitude, phasor.phaseDeg, unit)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-slate-400">
                {formatPhaseDeg(phasor.phaseDeg)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 交流相量分析结果：幅值∠相角表 + 功率表 + 复平面相量图 */
export function AcPhasorView({ result }: AcPhasorViewProps) {
  const [tab, setTab] = useState<PhasorTab>('voltage')

  const voltagePhasors = useMemo(
    () => toPhasors(result.node_voltages, result.node_phases_deg),
    [result.node_voltages, result.node_phases_deg],
  )
  const currentPhasors = useMemo(
    () => toPhasors(result.branch_currents, result.branch_phases_deg),
    [result.branch_currents, result.branch_phases_deg],
  )

  const sources = Object.entries(result.power?.sources ?? {}).sort(([a], [b]) => a.localeCompare(b))
  const elements = Object.entries(result.power?.elements ?? {}).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-medium text-slate-200">交流相量分析（单频正弦稳态）</h3>
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 font-mono text-sm text-blue-300">
          分析频率 f = {formatFrequency(result.frequency_hz)}
        </div>
      </div>

      {/* 幅值约定必须出现在读数旁边：正弦稳态里「峰值 vs 有效值」是最经典的混淆点，
          不能只把它埋在功率表脚注里（而且没有 power 时那段根本不渲染）。 */}
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
        幅值约定：下表与相量图中的所有幅值均为<strong>峰值</strong>（非有效值，有效值 = 峰值 / √2）；功率为平均值。
      </p>

      {/* 相量图 */}
      <section className="space-y-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">相量图（复平面，峰值幅值）</h4>
          <div className="flex items-center rounded-lg border border-slate-700 bg-slate-900/60 p-0.5">
            <button
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                tab === 'voltage' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setTab('voltage')}
            >
              节点电压
            </button>
            <button
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                tab === 'current' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setTab('current')}
            >
              支路电流
            </button>
          </div>
        </div>
        <PhasorDiagram
          phasors={tab === 'voltage' ? voltagePhasors : currentPhasors}
          unit={tab === 'voltage' ? 'V' : 'A'}
        />
      </section>

      {/* 幅值∠相角表 */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">节点电压相量</h4>
          <PhasorTable phasors={voltagePhasors} unit="V" columns={['节点', '电压幅值（峰值）∠ 相角', '相角']} />
        </div>
        <div>
          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">支路电流相量</h4>
          <PhasorTable phasors={currentPhasors} unit="A" columns={['支路', '电流幅值（峰值）∠ 相角', '相角']} />
        </div>
      </div>

      {/* 功率表 */}
      {result.power && (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">功率</h4>

          {sources.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 text-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">源</th>
                    <th className="px-3 py-2 text-right font-medium">有功 P</th>
                    <th className="px-3 py-2 text-right font-medium">无功 Q</th>
                    <th className="px-3 py-2 text-right font-medium">视在 S</th>
                    <th className="px-3 py-2 text-right font-medium">功率因数</th>
                    <th className="px-3 py-2 text-right font-medium">性质</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50 bg-slate-900/50">
                  {sources.map(([id, power]) => (
                    <tr key={id} className="transition-colors hover:bg-slate-800/50">
                      <td className="px-3 py-2 text-slate-400">{id}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-200">{formatEngineering(power.p_w, 'W')}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-200">{formatEngineering(power.q_var, 'var')}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-200">{formatEngineering(power.s_va, 'VA')}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-200">{formatPowerFactor(power.pf)}</td>
                      <td className="px-3 py-2 text-right font-mono text-amber-300">{reactiveNature(power.q_var)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {elements.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 text-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">元件</th>
                    <th className="px-3 py-2 text-right font-medium">耗散有功 P</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50 bg-slate-900/50">
                  {elements.map(([id, power]) => (
                    <tr key={id} className="transition-colors hover:bg-slate-800/50">
                      <td className="px-3 py-2 text-slate-400">{id}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-200">{formatEngineering(power.p_w, 'W')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 后端下发的功率约定，原样展示 */}
          {result.power.convention && (
            <p className="text-[11px] leading-relaxed text-slate-500">约定：{result.power.convention}</p>
          )}
        </section>
      )}
    </div>
  )
}
