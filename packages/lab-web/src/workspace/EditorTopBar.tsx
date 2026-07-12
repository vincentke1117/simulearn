import { useRef, type ChangeEvent } from 'react'
import { 
  Upload, 
  Download, 
  RotateCcw, 
  Play, 
  Loader2, 
  Layout,
  Settings2,
  ChevronDown
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@xyflow/react'
import type { SimulationSettings, AnalysisMethod, TheveninPortConfig } from '@/types/circuit'
import type { DiagramMode } from '@/types/control'

// 分析方法显示名称
const ANALYSIS_METHOD_LABELS: Record<AnalysisMethod, string> = {
  transient: '瞬态分析 (Transient)',
  node_voltage: '节点电压法 (Node Voltage)',
  branch_current: '支路电流法 (Branch Current)',
  mesh_current: '网孔电流法 (Mesh Current)',
  thevenin: '戴维南等效 (Thevenin)',
  dc_op: '直流工作点',
  ac_phasor: '交流相量分析',
}

export interface EditorTopBarProps {
  // Project props
  onExport: () => void
  onImport: (content: string) => Promise<void> | void
  onImportError?: (message: string) => void
  canExport: boolean
  onReset?: () => void
  
  // Simulation props
  settings: SimulationSettings
  onSettingsChange: (settings: SimulationSettings) => void
  onRun: () => void
  disabled?: boolean
  isRunning?: boolean
  isResistive?: boolean
  diagramMode?: DiagramMode
  hasResult?: boolean
  onShowResult?: () => void
  showResultPanel?: boolean
  availableNodes?: string[]
  theveninPort?: TheveninPortConfig
  onTheveninPortChange?: (config: TheveninPortConfig) => void
  teachingMode?: boolean
  onTeachingModeChange?: (enabled: boolean) => void

  // Workspace message
  message?: { tone: 'info' | 'error'; text: string } | null
}

export function EditorTopBar({
  onExport,
  onImport,
  onImportError,
  canExport,
  onReset,
  settings,
  onSettingsChange,
  onRun,
  disabled,
  isRunning,
  isResistive,
  diagramMode,
  hasResult,
  onShowResult,
  showResultPanel,
  availableNodes,
  theveninPort,
  onTheveninPortChange,
  teachingMode,
  onTeachingModeChange,
  message
}: EditorTopBarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
  const hasAcSource = useStore((state) =>
    state.nodes.some((node) => node.type === 'vsource_ac' || node.type === 'isource_ac'),
  )

  // 根据电路类型可用的分析方法（dc_op 在任何电气电路下可选；ac_phasor 仅当存在交流源时可选）
  const availableMethods: AnalysisMethod[] = diagramMode === 'control' || diagramMode === 'mixed'
    ? ['transient']
    : isResistive
      ? ['node_voltage', 'branch_current', 'mesh_current', 'thevenin', 'transient', 'dc_op']
      : hasAcSource
        ? ['transient', 'dc_op', 'ac_phasor']
        : ['transient', 'dc_op']
  
  const currentMethod: AnalysisMethod = diagramMode === 'control' || diagramMode === 'mixed'
    ? 'transient'
    : settings.method ?? 'transient'
  const isTransient = currentMethod === 'transient'
  const showTheveninConfig = diagramMode === 'electrical' && currentMethod === 'thevenin'
  const showTeachingMode = diagramMode === 'electrical' && isResistive && (currentMethod !== 'thevenin' && currentMethod !== 'transient' || (settings.comparisonMethods?.length ?? 0) > 0)

  return (
    <header className="!h-12 !min-h-[48px] !py-0 !bg-slate-900 border-b border-slate-700 flex flex-wrap items-center justify-between !px-3 shrink-0 z-10 gap-y-0">
      {/* Left: Project Controls */}
      <div className="flex items-center gap-2">
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
              <button
                className="ml-2 px-2 py-0.5 rounded border border-slate-700 hover:bg-slate-800 text-slate-300"
                onClick={() => navigator.clipboard?.writeText(message.text).catch(() => {})}
                title="复制提示"
              >复制</button>
            </motion.div>
          )}
        </AnimatePresence>
        
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

          {/* Transient Parameters */}
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

          {/* Voltage Display Mode */}
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

          {/* Thevenin Port Config */}
          {showTheveninConfig && (
            <div className="flex items-center gap-2">
              <div className="relative group">
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 flex items-center justify-center text-xs font-bold text-slate-400 group-hover:text-red-300 transition-colors" title="正端节点">+</div>
                <select
                  value={theveninPort?.positiveNode ?? ''}
                  onChange={(e) => onTheveninPortChange?.({
                    positiveNode: e.target.value,
                    negativeNode: theveninPort?.negativeNode ?? 'gnd'
                  })}
                  className="appearance-none bg-slate-800 text-slate-200 text-xs font-medium rounded-lg pl-8 pr-8 py-2 border border-slate-700 focus:outline-none focus:border-red-500 hover:border-slate-600 transition-all w-32"
                  aria-label="戴维南正端节点"
                >
                  <option value="">正极 (+)</option>
                  {availableNodes?.map(node => (
                    <option key={node} value={node}>{node}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>

              <div className="relative group">
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 flex items-center justify-center text-xs font-bold text-slate-400 group-hover:text-blue-300 transition-colors" title="负端节点">-</div>
                <select
                  value={theveninPort?.negativeNode ?? 'gnd'}
                  onChange={(e) => onTheveninPortChange?.({
                    positiveNode: theveninPort?.positiveNode ?? '',
                    negativeNode: e.target.value
                  })}
                  className="appearance-none bg-slate-800 text-slate-200 text-xs font-medium rounded-lg pl-8 pr-8 py-2 border border-slate-700 focus:outline-none focus:border-blue-500 hover:border-slate-600 transition-all w-32"
                  aria-label="戴维南负端节点"
                >
                  <option value="gnd">地 (GND)</option>
                  {availableNodes?.filter(n => n !== 'gnd').map(node => (
                    <option key={node} value={node}>{node}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
            </div>
          )}
        </div>

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

        {/* Run Button */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
          <span className="text-xs text-slate-400">Julia {''}
            <span className="inline-block align-middle" id="server-version" />
          </span>
          <button
            onClick={onRun}
            disabled={disabled || isRunning}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all
              ${disabled || isRunning 
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
                import('@/simulation/api').then(m => m.cancelSimulation())
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
