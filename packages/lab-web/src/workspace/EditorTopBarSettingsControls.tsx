import { ChevronDown, Layout, Settings2 } from 'lucide-react'
import {
  SWEEP_MAX_POINTS,
  SWEEP_MIN_POINTS,
  type AnalysisMethod,
  type SimulationSettings,
  type SweepSettings,
  type TheveninPortConfig,
} from '@/types/circuit'

const ANALYSIS_METHOD_LABELS: Record<AnalysisMethod, string> = {
  transient: '瞬态分析 (Transient)',
  node_voltage: '节点电压法 (Node Voltage)',
  branch_current: '支路电流法 (Branch Current)',
  mesh_current: '网孔电流法 (Mesh Current)',
  thevenin: '戴维南等效 (Thevenin)',
  dc_op: '直流工作点',
  ac_phasor: '交流相量分析',
  frequency_sweep: '频率扫描 (Bode)',
}

export interface TheveninPortPickerProps {
  availableNodes?: string[]
  port?: TheveninPortConfig
  onPortChange?: (config: TheveninPortConfig) => void
}

interface EditorTopBarSettingsControlsProps {
  settings: SimulationSettings
  onSettingsChange: (settings: SimulationSettings) => void
  currentMethod: AnalysisMethod
  availableMethods: AnalysisMethod[]
  sweep: SweepSettings
  updateSweep: (patch: Partial<SweepSettings>) => void
  thevenin?: TheveninPortPickerProps
}

const THEVENIN_POLARITY_CONFIG = {
  positive: {
    marker: '+',
    title: '正端节点',
    ariaLabel: '戴维南正端节点',
    optionValue: '',
    optionLabel: '正极 (+)',
    markerHoverClass: 'group-hover:text-red-300',
    focusClass: 'focus:outline-none focus:border-red-500',
  },
  negative: {
    marker: '-',
    title: '负端节点',
    ariaLabel: '戴维南负端节点',
    optionValue: 'gnd',
    optionLabel: '地 (GND)',
    markerHoverClass: 'group-hover:text-blue-300',
    focusClass: 'focus:outline-none focus:border-blue-500',
  },
} as const

type TheveninPolarity = keyof typeof THEVENIN_POLARITY_CONFIG

function TheveninPortSelect({ polarity, picker }: { polarity: TheveninPolarity; picker: TheveninPortPickerProps }) {
  const config = THEVENIN_POLARITY_CONFIG[polarity]
  const isPositive = polarity === 'positive'
  const value = isPositive ? (picker.port?.positiveNode ?? '') : (picker.port?.negativeNode ?? 'gnd')
  const nodes = isPositive
    ? (picker.availableNodes ?? [])
    : (picker.availableNodes ?? []).filter((node) => node !== 'gnd')

  return (
    <div className="relative group">
      <div
        className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 flex items-center justify-center text-xs font-bold text-slate-400 ${config.markerHoverClass} transition-colors`}
        title={config.title}
      >
        {config.marker}
      </div>
      <select
        value={value}
        onChange={(e) => picker.onPortChange?.({
          positiveNode: isPositive ? e.target.value : (picker.port?.positiveNode ?? ''),
          negativeNode: isPositive ? (picker.port?.negativeNode ?? 'gnd') : e.target.value,
        })}
        className={`appearance-none bg-slate-800 text-slate-200 text-xs font-medium rounded-lg pl-8 pr-8 py-2 border border-slate-700 hover:border-slate-600 transition-all w-32 ${config.focusClass}`}
        aria-label={config.ariaLabel}
      >
        <option value={config.optionValue}>{config.optionLabel}</option>
        {nodes.map(node => (
          <option key={node} value={node}>{node}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
    </div>
  )
}

export function EditorTopBarSettingsControls({
  settings,
  onSettingsChange,
  currentMethod,
  availableMethods,
  sweep,
  updateSweep,
  thevenin,
}: EditorTopBarSettingsControlsProps) {
  const isTransient = currentMethod === 'transient'
  const isSweep = currentMethod === 'frequency_sweep'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative group">
        <Settings2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-hover:text-blue-300 transition-colors" />
        <select
          value={currentMethod}
          onChange={(e) => onSettingsChange({ ...settings, method: e.target.value as AnalysisMethod })}
          className="appearance-none bg-slate-800 text-slate-200 text-xs font-medium rounded-lg pl-8 pr-8 py-2 border border-slate-700 focus:outline-none focus:border-blue-500 hover:border-slate-600 transition-all w-48"
          aria-label="选择分析方法"
        >
          {availableMethods.map(method => (
            <option key={method} value={method}>
              {ANALYSIS_METHOD_LABELS[method]}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
      </div>

      {isTransient && (
        <>
          <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 border border-slate-700" title="仿真停止时间">
            <span className="text-xs text-slate-300">时间</span>
            <input
              type="number"
              value={settings.tStop}
              onChange={(e) => onSettingsChange({ ...settings, tStop: parseFloat(e.target.value) })}
              className="w-16 bg-transparent text-xs text-slate-200 focus:outline-none font-mono text-right"
              step={0.001}
              min={0}
            />
            <span className="text-xs text-slate-400">s</span>
          </div>
          <div className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 border border-slate-700" title="采样点数">
            <span className="text-xs text-slate-300">采样</span>
            <input
              type="number"
              value={settings.nSamples}
              onChange={(e) => onSettingsChange({ ...settings, nSamples: parseInt(e.target.value) })}
              className="w-12 bg-transparent text-xs text-slate-200 focus:outline-none font-mono text-right"
              step={100}
              min={10}
            />
          </div>
        </>
      )}

      {isSweep && (
        <>
          <div
            className={`flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 border ${
              sweep.fStartHz > 0 ? 'border-slate-700' : 'border-red-500/60'
            }`}
            title="扫描起始频率（必须 > 0）"
          >
            <span className="text-xs text-slate-300">f起</span>
            <input
              type="number"
              value={sweep.fStartHz}
              onChange={(e) => updateSweep({ fStartHz: parseFloat(e.target.value) })}
              className="w-16 bg-transparent text-xs text-slate-200 focus:outline-none font-mono text-right"
              step={1}
              min={0}
              aria-label="扫描起始频率"
            />
            <span className="text-xs text-slate-400">Hz</span>
          </div>
          <div
            className={`flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 border ${
              sweep.fStopHz > sweep.fStartHz ? 'border-slate-700' : 'border-red-500/60'
            }`}
            title="扫描终止频率（必须 > 起始频率）"
          >
            <span className="text-xs text-slate-300">f止</span>
            <input
              type="number"
              value={sweep.fStopHz}
              onChange={(e) => updateSweep({ fStopHz: parseFloat(e.target.value) })}
              className="w-20 bg-transparent text-xs text-slate-200 focus:outline-none font-mono text-right"
              step={1}
              min={0}
              aria-label="扫描终止频率"
            />
            <span className="text-xs text-slate-400">Hz</span>
          </div>
          <div
            className={`flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2 border ${
              Number.isInteger(sweep.nPoints) && sweep.nPoints >= SWEEP_MIN_POINTS && sweep.nPoints <= SWEEP_MAX_POINTS
                ? 'border-slate-700'
                : 'border-red-500/60'
            }`}
            title={`扫描点数（${SWEEP_MIN_POINTS}..${SWEEP_MAX_POINTS}）`}
          >
            <span className="text-xs text-slate-300">点数</span>
            <input
              type="number"
              value={sweep.nPoints}
              onChange={(e) => updateSweep({ nPoints: parseInt(e.target.value, 10) })}
              className="w-12 bg-transparent text-xs text-slate-200 focus:outline-none font-mono text-right"
              step={10}
              min={SWEEP_MIN_POINTS}
              max={SWEEP_MAX_POINTS}
              aria-label="扫描点数"
            />
          </div>
          <span className="text-[10px] text-slate-500 font-mono" title="v1 仅支持对数刻度">log 刻度</span>
        </>
      )}

      <div className="relative group">
        <Layout className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-hover:text-blue-300 transition-colors" />
        <select
          value={settings.voltageDisplayMode ?? 'node'}
          onChange={(e) => onSettingsChange({ ...settings, voltageDisplayMode: e.target.value as ('node' | 'element') })}
          className="appearance-none bg-slate-800 text-slate-200 text-xs font-medium rounded-lg pl-8 pr-8 py-2 border border-slate-700 focus:outline-none focus:border-blue-500 hover:border-slate-600 transition-all w-32"
          aria-label="电压显示模式"
        >
          <option value="node">节点电压</option>
          <option value="element">元件电压</option>
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
      </div>

      {thevenin && (
        <div className="flex items-center gap-2">
          <TheveninPortSelect polarity="positive" picker={thevenin} />
          <TheveninPortSelect polarity="negative" picker={thevenin} />
        </div>
      )}
    </div>
  )
}
