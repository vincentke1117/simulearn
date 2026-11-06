import { useEffect, useMemo, useRef, type ChangeEvent } from 'react'
import { 
  Upload, 
  Download, 
  RotateCcw, 
  Play, 
  Loader2, 
  Layout,
  ChevronLeft
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@xyflow/react'
import {
  SWEEP_MAX_POINTS,
  SWEEP_MIN_POINTS,
  defaultSweepSettings,
  type SimulationSettings,
  type AnalysisMethod,
  type TheveninPortConfig,
  type SweepSettings,
} from '@/types/circuit'
import type { DiagramMode } from '@/types/control'
import { cancelSimulation } from '@/simulation/api'
import { EditorTopBarSettingsControls } from './EditorTopBarSettingsControls'
import { useTwoStep } from './useTwoStep'

export interface EditorTopBarProps {
  // Project props
  onExport: () => void
  onImport: (content: string) => Promise<void> | void
  onImportError?: (message: string) => void
  canExport: boolean
  onReset?: () => void
  /** 嵌入模式：给了它就只留「恢复初始电路」，不显示导入 / 导出 / 清空（iframe 沙箱不许下载） */
  onRestoreInitial?: () => void
  /** 案例库里打开的案例：回到案例列表 */
  onBack?: () => void
  
  // Simulation props
  settings: SimulationSettings
  onSettingsChange: (settings: SimulationSettings) => void
  onRun: () => void
  disabled?: boolean
  isRunning?: boolean
  isResistive?: boolean
  /**
   * 有没有交流源 / 探针：工作区按自己的 nodes 状态算好传进来。
   * 不能只读 React Flow 的 store：画布首帧 store 还是空的，下面那个 effect 会以为「交流相量不可用」，
   * 把案例预设的 ac_phasor 清掉，学生一点运行跑的就是瞬态（例 11-2 是 7.96 MHz 电路，瞬态要算很久）
   */
  hasAcSource?: boolean
  hasProbe?: boolean
  diagramMode?: DiagramMode
  hasResult?: boolean
  onShowResult?: () => void
  showResultPanel?: boolean
  availableNodes?: string[]
  /** 网络名 → 探针名 / 元件端子：端口下拉里配在网络名后面 */
  availableNodeLabels?: Record<string, string>
  theveninPort?: TheveninPortConfig
  onTheveninPortChange?: (config: TheveninPortConfig) => void
  teachingMode?: boolean
  onTeachingModeChange?: (enabled: boolean) => void

  // Workspace message
  message?: { tone: 'info' | 'error'; text: string } | null
}

const noop = () => {}

export function EditorTopBar({
  onExport,
  onImport,
  onImportError,
  canExport,
  onReset,
  onRestoreInitial,
  onBack,
  settings,
  onSettingsChange,
  onRun,
  disabled,
  isRunning,
  isResistive,
  hasAcSource: hasAcSourceProp,
  hasProbe: hasProbeProp,
  diagramMode,
  hasResult,
  onShowResult,
  showResultPanel,
  availableNodes,
  availableNodeLabels,
  theveninPort,
  onTheveninPortChange,
  teachingMode,
  onTeachingModeChange,
  message
}: EditorTopBarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const restore = useTwoStep(onRestoreInitial ?? noop)

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      try {
        await onImport(text)
      } catch (error) {
        onImportError?.(
          error instanceof Error ? error.message : '导入失败，文件内容不符合要求',
        )
      } finally {
        event.target.value = ''
      }
    }
    reader.onerror = () => {
      onImportError?.('读取文件失败')
      event.target.value = ''
    }
    reader.readAsText(file)
  }

  // 是否存在交流源（与 payload.ts 读取 nodes 判断元件类型的模式一致；
  // EditorTopBar 处于 ReactFlowProvider 内，直接从 store 读取 nodes）
  const storeHasAcSource = useStore((state) =>
    state.nodes.some((node) => node.type === 'vsource_ac' || node.type === 'isource_ac'),
  )
  const hasAcSource = hasAcSourceProp ?? storeHasAcSource

  // 频率扫描要求至少一个探针（Bode 曲线按探针出图）
  const storeHasProbe = useStore((state) =>
    state.nodes.some((node) => node.type === 'voltage_probe' || node.type === 'current_probe'),
  )
  const hasProbe = hasProbeProp ?? storeHasProbe

  // 根据电路类型可用的分析方法（dc_op 在任何电气电路下可选；ac_phasor / frequency_sweep 仅当存在交流源时可选）
  const availableMethods: AnalysisMethod[] = useMemo(
    () => diagramMode === 'control' || diagramMode === 'mixed'
      ? ['transient']
      : isResistive
        ? ['node_voltage', 'branch_current', 'mesh_current', 'thevenin', 'transient', 'dc_op']
        : hasAcSource
          ? ['transient', 'dc_op', 'ac_phasor', 'frequency_sweep']
          : ['transient', 'dc_op'],
    [diagramMode, hasAcSource, isResistive],
  )

  // 未显式选择方法时，payload.ts 会走 getDefaultAnalysisMethod(nodes)：纯电阻 → node_voltage，其余 → transient。
  // 下拉框必须显示同一个回落值，否则「显示的方法 ≠ 实际跑的方法」（纯电阻电路直接点运行，
  // 下拉框写着「瞬态分析」，实际发出去的是 node_voltage）。
  const defaultMethod: AnalysisMethod = isResistive ? 'node_voltage' : 'transient'
  const settingsMethod = settings.method
  // 选中的方法可能因为电路被编辑（例如删掉交流源）而不再可用 —— 此时 <select> 会渲染成空白。
  // 回落到默认方法，并在 effect 里把 settings.method 一起清掉，保证「显示 = 实际」。
  const methodAvailable = settingsMethod !== undefined && availableMethods.includes(settingsMethod)
  const currentMethod: AnalysisMethod = diagramMode === 'control' || diagramMode === 'mixed'
    ? 'transient'
    : methodAvailable
      ? (settingsMethod as AnalysisMethod)
      : defaultMethod

  useEffect(() => {
    if (diagramMode !== 'electrical') return
    if (settingsMethod === undefined) return
    if (availableMethods.includes(settingsMethod)) return
    // 当前电路不再支持这个方法：清掉，交回自动检测（与 payload.ts 的回落一致）
    onSettingsChange({ ...settings, method: undefined })
  }, [availableMethods, diagramMode, onSettingsChange, settings, settingsMethod])

  const isSweep = currentMethod === 'frequency_sweep'
  const sweep: SweepSettings = settings.sweep ?? defaultSweepSettings
  const showTheveninConfig = diagramMode === 'electrical' && currentMethod === 'thevenin'
  const showTeachingMode = diagramMode === 'electrical' && isResistive && (currentMethod !== 'thevenin' && currentMethod !== 'transient' || (settings.comparisonMethods?.length ?? 0) > 0)

  const updateSweep = (patch: Partial<SweepSettings>) => {
    onSettingsChange({ ...settings, sweep: { ...sweep, ...patch } })
  }

  // 提交前的可读提示（后端会返回 422，但学生不该先吃一个报错才知道少了探针）
  const sweepHints: string[] = []
  if (isSweep) {
    if (!hasProbe) sweepHints.push('频率扫描需要至少一个探针（电压探针 / 电流探针）')
    if (!(sweep.fStartHz > 0)) sweepHints.push('起始频率必须大于 0')
    else if (!(sweep.fStopHz > sweep.fStartHz)) sweepHints.push('终止频率必须大于起始频率')
    if (!Number.isInteger(sweep.nPoints) || sweep.nPoints < SWEEP_MIN_POINTS || sweep.nPoints > SWEEP_MAX_POINTS) {
      sweepHints.push(`点数必须在 ${SWEEP_MIN_POINTS}..${SWEEP_MAX_POINTS} 之间`)
    }
  }
  const sweepInvalid = sweepHints.length > 0

  return (
    <header className="!h-12 !min-h-[48px] !py-0 !bg-slate-900 border-b border-slate-700 flex flex-wrap items-center justify-between !px-3 shrink-0 z-10 gap-y-0">
      {/* Left: Project Controls */}
      <div className="flex items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-medium text-slate-300 hover:text-blue-400 transition-colors"
            title="回到案例列表；你在这个案例里的修改会保留"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            案例列表
          </button>
        )}
        {onRestoreInitial ? (
          <button
            onClick={restore.click}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              restore.armed
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-blue-400'
            }`}
            title="把电路恢复成课堂给的初始电路，你的修改会丢掉"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {restore.armed ? '再点一次确认恢复' : '恢复初始电路'}
          </button>
        ) : (
        <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700">
          <button
            onClick={handleImportClick}
            className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700/50 rounded-md transition-colors"
            title="导入项目"
            aria-label="导入项目"
          >
            <Upload className="w-4 h-4" />
          </button>
          <button
            onClick={onExport}
            disabled={!canExport}
            className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700/50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="导出项目"
            aria-label="导出项目"
          >
            <Download className="w-4 h-4" />
          </button>
          {onReset && (
            <button
              onClick={onReset}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700/50 rounded-md transition-colors"
              title="重置电路"
              aria-label="重置电路"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
        )}

        {/* Workspace Message */}
        <AnimatePresence>
          {message && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                message.tone === 'error' 
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                  : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
              }`}
            >
              {message.tone === 'error' ? (
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              ) : (
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              )}
              <span>{message.text}</span>
              {/* 嵌入时不给「复制」：跨源 iframe 没有写剪贴板的权限，点了没反应 */}
              {!onRestoreInitial && <button
                className="ml-2 px-2 py-0.5 rounded border border-slate-700 hover:bg-slate-800 text-slate-300"
                onClick={() => navigator.clipboard?.writeText(message.text).catch(() => {})}
                title="复制提示"
              >复制</button>}
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* 混合仿真边界明示：准静态耦合，电路侧仅支持纯电阻 */}
        {diagramMode === 'mixed' && (
          <span
            className="text-[11px] text-slate-500 whitespace-nowrap"
            title="MixedSimulation 采用准静态显式欧拉耦合：每个时间步把电路当作纯电阻网络求解，电容/电感的动态不参与"
          >
            混合仿真为准静态耦合：电路侧仅支持纯电阻，L/C 动态不参与
          </span>
        )}

        <input
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
          accept="application/json"
          onChange={handleFileChange}
        />
      </div>

      {/* Right: Simulation Controls */}
      <div className="flex flex-wrap items-center gap-4 justify-end">
        {/* Method Selection */}
        <EditorTopBarSettingsControls
          settings={settings}
          onSettingsChange={onSettingsChange}
          currentMethod={currentMethod}
          availableMethods={availableMethods}
          sweep={sweep}
          updateSweep={updateSweep}
          thevenin={showTheveninConfig ? { availableNodes, nodeLabels: availableNodeLabels, port: theveninPort, onPortChange: onTheveninPortChange } : undefined}
        />

        {/* Teaching Mode Toggle */}
        {showTeachingMode && (
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                checked={teachingMode}
                onChange={(e) => onTeachingModeChange?.(e.target.checked)}
                className="sr-only peer"
                aria-label="教学模式"
              />
              <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </div>
            <span className="text-xs font-medium text-slate-400 group-hover:text-slate-200 transition-colors">教学模式</span>
          </label>
        )}

        {/* Branch Current Toggle */}
        <label className="flex items-center gap-2 cursor-pointer group border-l border-slate-800 pl-4">
          <div className="relative">
            <input
              type="checkbox"
              checked={settings.showBranchCurrents ?? false}
              onChange={(e) => onSettingsChange({ ...settings, showBranchCurrents: e.target.checked })}
              className="sr-only peer"
              aria-label="显示支路电流"
            />
            <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
          </div>
          <span className="text-xs font-medium text-slate-400 group-hover:text-slate-200 transition-colors">支路电流</span>
        </label>

        {/* Sweep pre-flight hints：提交前就告诉学生缺什么，而不是让后端回一个 422 */}
        {sweepInvalid && (
          <span className="text-[11px] text-amber-400 max-w-[22rem] leading-tight" role="status">
            {sweepHints.join('；')}
          </span>
        )}

        {/* Run Button */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
          <span className="text-xs text-slate-400">Julia {''}
            <span className="inline-block align-middle" id="server-version" />
          </span>
          <button
            onClick={onRun}
            disabled={disabled || isRunning || sweepInvalid}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all
              ${disabled || isRunning || sweepInvalid
                ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20 active:scale-95'
              }
            `}
            aria-label="运行仿真"
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            {isRunning ? '仿真中...' : '运行仿真'}
          </button>
          
          {hasResult && (
             <button
              onClick={onShowResult}
              className={`p-2 rounded-lg transition-colors ${
                showResultPanel 
                  ? 'bg-blue-500/10 text-blue-500' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title="显示/隐藏结果"
              aria-label="显示或隐藏结果"
            >
              <Layout className="w-4 h-4" />
            </button>
          )}
          {isRunning && (
            <button
              onClick={() => {
                cancelSimulation()
              }}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-700 text-slate-200 hover:bg-slate-600"
              aria-label="取消仿真"
            >取消</button>
          )}
        </div>
      </div>
    </header>
  )
}
