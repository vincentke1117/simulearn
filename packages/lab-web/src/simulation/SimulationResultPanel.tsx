import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { X, FileJson, FileSpreadsheet, FileText, Activity, Layout, Move } from 'lucide-react'
import { motion } from 'framer-motion'
import { MatrixDisplay, VectorDisplay } from '@/components/MatrixDisplay'
import type {
  SimulationData,
  AnalysisResultData,
  NodeVoltageResult,
  TheveninResult,
  BranchCurrentResult,
  SimulationErrorInfo,
  AcPhasorResult,
  FrequencySweepResult,
} from '@/types/circuit'
import type { DiagramMode } from '@/types/control'
import { classifyResult } from './resultKind'
import { AcPhasorView } from './AcPhasorView'
import { BodePlot } from './BodePlot'
import { StepResponseChart } from './StepResponseChart'
import { formatEngineering } from './format'

export interface SimulationResultPanelProps {
  result: AnalysisResultData | null
  error: SimulationErrorInfo | null
  isRunning: boolean
  method?: string
  diagramMode?: DiagramMode
  onClose?: () => void
}

interface TeachingMatrices {
  step2?: {
    G: number[][]
    I: number[]
    nodes: string[]
  }
  step6?: {
    V: number[]
    nodes: string[]
  }
}

interface TeachingResult {
  steps?: string[]
  matrices?: TeachingMatrices
}

type ComparisonResults = Record<string, AnalysisResultData | null>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function SimulationResultPanel({ result, error, isRunning, method, diagramMode, onClose }: SimulationResultPanelProps) {
  // 单一分派入口：以结果结构为主、method 仅用于消歧。
  // 旧代码按 `method === 'node_voltage'` 硬匹配，后端新增 dc_op / ac_phasor / frequency_sweep 后
  // 全部分支落空 → 面板显示"暂无仿真结果"。classifyResult 堵死这个洞。
  const kind = useMemo(() => classifyResult(method, result), [method, result])

  const comparisonResults = kind.kind === 'comparison' ? (kind.data as ComparisonResults) : null

  const isTransientResult = kind.kind === 'transient'
  const isDcTable = kind.kind === 'dc_solve' || kind.kind === 'dc_op'
  const isBranchCurrentResult = kind.kind === 'dc_solve' && kind.method === 'branch_current'
  const isMeshCurrentResult = kind.kind === 'dc_solve' && kind.method === 'mesh_current'
  const isDcOpResult = kind.kind === 'dc_op'
  const isTheveninResult = kind.kind === 'thevenin'
  const hasSignals = Boolean(isTransientResult && (result as SimulationData).signals.length > 0)
  const teachingResult = isRecord(result) ? result as TeachingResult : null
  const transientMetrics = isTransientResult ? (result as SimulationData).metrics : undefined

  const [showBranch, setShowBranch] = useState(true)
  const [showNode, setShowNode] = useState(true)

  function VirtualTable({ entries, columns }: { entries: [string, number][]; columns: [string, string] }) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const rowHeight = 28
    const containerHeight = 300
    const [start, setStart] = useState(0)
    const visible = Math.ceil(containerHeight / rowHeight) + 4
    const onScroll = useCallback(() => {
      const top = containerRef.current?.scrollTop ?? 0
      setStart(Math.max(0, Math.floor(top / rowHeight) - 2))
    }, [])
    useEffect(() => {
      const el = containerRef.current
      if (!el) return
      el.addEventListener('scroll', onScroll)
      return () => el.removeEventListener('scroll', onScroll)
    }, [onScroll])
    const slice = entries.slice(start, start + visible)
    return (
      <div className="overflow-auto" style={{ height: containerHeight }} ref={containerRef}>
        <div style={{ height: entries.length * rowHeight, position: 'relative' }}>
          <table className="w-full text-sm absolute left-0" style={{ top: start * rowHeight }}>
            <thead className="bg-slate-800 text-slate-200 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left font-medium">{columns[0]}</th>
                <th className="px-4 py-2 text-right font-medium">{columns[1]}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50 bg-slate-900/50">
              {slice.map(([k, v]) => (
                <tr key={`${k}-${start}`} className="hover:bg-slate-800/50 transition-colors" style={{ height: rowHeight }}>
                  <td className="px-4 py-2 text-slate-400">{k}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-300">{typeof v === 'number' ? v.toFixed(6) : v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // 导出JSON格式
  const handleExportJSON = useCallback(() => {
    if (!result) return
    const dataStr = JSON.stringify(result, null, 2)
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `simulation-result-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }, [result])

  // 导出CSV格式
  const handleExportCSV = useCallback(() => {
    if (!result) return
    let csvContent = ''

    if (kind.kind === 'ac_phasor') {
      const data = kind.data
      csvContent += `交流相量分析 (f = ${data.frequency_hz} Hz)\n`
      csvContent += '节点,电压幅值(V,峰值),电压相角(deg)\n'
      Object.entries(data.node_voltages).forEach(([node, magnitude]) => {
        csvContent += `${node},${magnitude},${data.node_phases_deg[node] ?? 0}\n`
      })
      csvContent += '\n支路,电流幅值(A,峰值),电流相角(deg)\n'
      Object.entries(data.branch_currents).forEach(([branch, magnitude]) => {
        csvContent += `${branch},${magnitude},${data.branch_phases_deg[branch] ?? 0}\n`
      })
      if (data.power) {
        csvContent += '\n源,P(W),Q(var),S(VA),功率因数\n'
        Object.entries(data.power.sources).forEach(([id, p]) => {
          csvContent += `${id},${p.p_w},${p.q_var},${p.s_va},${p.pf}\n`
        })
        csvContent += '\n元件,耗散P(W)\n'
        Object.entries(data.power.elements).forEach(([id, p]) => {
          csvContent += `${id},${p.p_w}\n`
        })
        csvContent += `\n约定,"${data.power.convention}"\n`
      }
    } else if (kind.kind === 'frequency_sweep') {
      const data = kind.data
      const probeIds = Object.keys(data.probes)
      csvContent += '频率(Hz),'
      probeIds.forEach((id) => { csvContent += `${id}_mag,${id}_mag_dB,${id}_phase_deg,` })
      csvContent += '\n'
      data.freq_hz.forEach((f, i) => {
        csvContent += `${f},`
        probeIds.forEach((id) => {
          const curve = data.probes[id]
          csvContent += `${curve.mag[i]},${curve.mag_db[i]},${curve.phase_deg[i]},`
        })
        csvContent += '\n'
      })
    } else if (isDcTable) {
      const data = result as NodeVoltageResult

      if (data.node_voltages) {
        csvContent += '节点电压\n'
        csvContent += '节点,电压(V)\n'
        Object.entries(data.node_voltages).forEach(([node, voltage]) => {
          csvContent += `${node},${voltage}\n`
        })
        csvContent += '\n'
      }

      if (data.branch_currents) {
        csvContent += '支路电流\n'
        csvContent += '支路,电流(A)\n'
        Object.entries(data.branch_currents).forEach(([branch, current]) => {
          csvContent += `${branch},${current}\n`
        })
      }
    } else if (isTheveninResult) {
      const data = result as TheveninResult
      csvContent += '戴维南等效\n'
      csvContent += '参数,值\n'
      csvContent += `Vth(V),${data.vth}\n`
      csvContent += `Rth(Ω),${data.rth}\n`
    } else if (isTransientResult) {
      const data = result as SimulationData
      csvContent += '时间,'
      data.signals.forEach(s => { csvContent += `${s.label},` })
      csvContent += '\n'
      for (let i = 0; i < data.time.length; i++) {
        csvContent += `${data.time[i]},`
        data.signals.forEach(s => { csvContent += `${s.values[i]},` })
        csvContent += '\n'
      }
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `simulation-result-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [result, kind, isDcTable, isTheveninResult, isTransientResult])

  // 导出PDF报告
  const handleExportPDF = useCallback(async () => {
    if (!result) return
    
    const element = document.querySelector('.simulation-result-content') as HTMLElement
    if (!element) return

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#0f172a', // Dark background for capture
        logging: false,
        useCORS: true
      })

      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const imgWidth = 210 // A4 宽度
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      
      pdf.setFillColor(15, 23, 42)
      pdf.rect(0, 0, 210, 297, 'F')
      
      pdf.setTextColor(255, 255, 255)
      pdf.setFontSize(16)
      pdf.text('J-Circuit 仿真结果报告', 105, 15, { align: 'center' })
      pdf.setFontSize(10)
      pdf.setTextColor(148, 163, 184)
      pdf.text(`生成时间: ${new Date().toLocaleString('zh-CN')}`, 105, 22, { align: 'center' })
      
      pdf.addImage(imgData, 'PNG', 0, 30, imgWidth, imgHeight)
      
      pdf.save(`simulation-report-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`)
    } catch (error) {
      console.error('PDF export failed:', error)
      alert('导出PDF失败，请重试')
    }
  }, [result])
  
  const [position, setPosition] = useState({ x: 100, y: 100 })
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })

  const handleMouseDownDrag = (e: React.MouseEvent) => {
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    }
    e.preventDefault()
  }

  const handleMouseDownResize = (e: React.MouseEvent) => {
    setIsResizing(true)
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    }
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const minY = -10
        const maxY = window.innerHeight - 40
        const minX = -size.width + 100
        const maxX = window.innerWidth - 100
        
        const newX = e.clientX - dragStartRef.current.x
        const newY = e.clientY - dragStartRef.current.y
        
        setPosition({
          x: Math.max(minX, Math.min(maxX, newX)),
          y: Math.max(minY, Math.min(maxY, newY)),
        })
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStartRef.current.x
        const deltaY = e.clientY - resizeStartRef.current.y
        setSize({
          width: Math.max(400, resizeStartRef.current.width + deltaX),
          height: Math.max(300, resizeStartRef.current.height + deltaY),
        })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, isResizing, size.width])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      transition={{ duration: 0.2 }}
      className="fixed z-50 flex flex-col overflow-hidden bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-slate-950/50"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 cursor-move select-none shrink-0"
        onMouseDown={handleMouseDownDrag}
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-semibold text-slate-200">仿真结果</span>
        </div>
        
        <div className="flex items-center gap-2">
          {result && (
            <div className="flex items-center bg-slate-700/50 rounded-lg p-1 border border-slate-600/50 mr-2">
              <button
                className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-600 rounded-md transition-colors"
                onClick={(e) => { e.stopPropagation(); handleExportJSON() }}
                title="导出JSON"
              >
                <FileJson className="w-3.5 h-3.5" />
              </button>
              <button
                className="p-1.5 text-slate-400 hover:text-green-400 hover:bg-slate-600 rounded-md transition-colors"
                onClick={(e) => { e.stopPropagation(); handleExportCSV() }}
                title="导出CSV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
              </button>
              <button
                className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-600 rounded-md transition-colors"
                onClick={(e) => { e.stopPropagation(); handleExportPDF() }}
                title="导出PDF报告"
              >
                <FileText className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          
          <div className="w-px h-4 bg-slate-700 mx-1" />
          
          <Move className="w-3.5 h-3.5 text-slate-500 mr-2 opacity-50" />
          
          {onClose && (
            <button 
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-700 rounded-full transition-colors" 
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-slate-900/50 p-4 simulation-result-content custom-scrollbar relative">
        {isRunning ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
            <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            <p className="text-sm">正在运行仿真，请稍候…</p>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-3">
            <Activity className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h4 className="font-semibold">仿真错误</h4>
                {error.code && (
                  <code className="rounded bg-red-500/20 px-1.5 py-0.5 font-mono text-[11px] text-red-300">
                    {error.code}
                  </code>
                )}
              </div>
              <p className="break-words">{error.message}</p>
              {error.data && Object.keys(error.data).length > 0 && (
                <dl className="mt-2 space-y-0.5 text-[11px] text-red-300/80">
                  {Object.entries(error.data).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="font-mono">{key}</dt>
                      <dd className="font-mono">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        ) : kind.kind === 'ac_phasor' ? (
          <AcPhasorView result={kind.data as AcPhasorResult} />
        ) : kind.kind === 'frequency_sweep' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-medium text-slate-200">频率扫描 (Bode 图)</h3>
              <span className="font-mono text-xs text-slate-500">
                {formatEngineering((kind.data as FrequencySweepResult).freq_hz[0], 'Hz')} →{' '}
                {formatEngineering(
                  (kind.data as FrequencySweepResult).freq_hz[(kind.data as FrequencySweepResult).freq_hz.length - 1],
                  'Hz',
                )}
                {' · '}
                {(kind.data as FrequencySweepResult).freq_hz.length} 点 · 对数刻度
              </span>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-2">
              <BodePlot result={kind.data as FrequencySweepResult} />
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              上：探针幅值 20·log₁₀(|X| / 1 单位) (dB)；下：探针相角 (°)。每条曲线对应一个探针（电压探针 X 为 V、电流探针为 A），幅值为峰值。
              <br />
              注意：这是探针处的<strong className="text-slate-400">绝对幅值</strong>，不是传递函数 |H| = Vout/Vin。
              若要读 −3 dB 截止频率，需自行减去源幅值的 20·log₁₀(A_src)（源幅值 = 1 V 时两者才重合）。
            </p>
          </div>
        ) : comparisonResults ? (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-400 flex items-center gap-2">
              <Layout className="w-4 h-4" />
              分析方法对比 ({Object.keys(comparisonResults).length} 列)
            </h3>
            <div 
              className="grid gap-4 min-w-full"
              style={{ gridTemplateColumns: `repeat(${Object.keys(comparisonResults).length}, 1fr)` }}
            >
              {Object.entries(comparisonResults).map(([methodKey, methodResult]) => {
                const methodName: Record<string, string> = {
                  'node_voltage': '节点电压法',
                  'branch_current': '支路电流法',
                  'mesh_current': '网孔电流法',
                  'thevenin': '戴维南等效'
                }
                const methodTeaching = isRecord(methodResult) ? methodResult as TeachingResult : null
                const methodNodeVoltages =
                  methodResult && isRecord(methodResult) && 'node_voltages' in methodResult
                    ? (methodResult as unknown as NodeVoltageResult).node_voltages
                    : null
                
                return (
                  <div key={methodKey} className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-blue-400 border-b border-slate-700 pb-2 mb-3">
                      {methodName[methodKey] || methodKey}
                    </h4>
                    
                    {!methodResult ? (
                      <div className="text-red-400 text-xs">此方法运行失败</div>
                    ) : 'vth' in methodResult && 'rth' in methodResult ? (
                      <div className="space-y-3">
                        <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                          <div className="text-xs text-slate-500 mb-1">V<sub>th</sub></div>
                          <div className="text-lg font-bold text-blue-400">{(methodResult.vth as number).toFixed(6)} V</div>
                        </div>
                        <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50">
                          <div className="text-xs text-slate-500 mb-1">R<sub>th</sub></div>
                          <div className="text-lg font-bold text-blue-400">{(methodResult.rth as number).toFixed(6)} Ω</div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {methodTeaching?.steps && methodTeaching.steps.length > 0 && (
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                            <h6 className="text-[10px] font-bold text-amber-500 uppercase mb-2">步骤</h6>
                            <ol className="text-[10px] text-amber-200/80 list-decimal pl-4 space-y-1">
                              {methodTeaching.steps.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          </div>
                        )}
                        
                        {/* 简略结果显示 */}
                        <div>
                          <h5 className="text-xs font-semibold text-slate-400 mb-2">节点电压</h5>
                          <div className="space-y-1">
                            {Object.entries(methodNodeVoltages ?? {}).slice(0, 5).map(([node, voltage]) => (
                              <div key={node} className="flex justify-between text-xs border-b border-slate-700/30 pb-1 last:border-0">
                                <span className="text-slate-500">{node}</span>
                                <span className="font-mono text-slate-300">{voltage.toFixed(4)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : isTheveninResult ? (
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-slate-200">戴维南等效电路</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center">
                <div className="text-sm text-slate-400 mb-2">戴维南电压 (V<sub>th</sub>)</div>
                <div className="text-2xl font-bold text-blue-400">{(result as TheveninResult).vth.toFixed(6)} V</div>
              </div>
              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center">
                <div className="text-sm text-slate-400 mb-2">戴维南电阻 (R<sub>th</sub>)</div>
                <div className="text-2xl font-bold text-emerald-400">{(result as TheveninResult).rth.toFixed(6)} Ω</div>
              </div>
            </div>
            
            <div className="flex justify-center py-8 bg-slate-800/30 rounded-xl border border-slate-700/50">
              <svg viewBox="0 0 300 150" className="w-80 max-w-full">
                <line x1="30" y1="75" x2="80" y2="75" stroke="#475569" strokeWidth="2" />
                <text x="30" y="65" fontSize="12" fill="#94a3b8">+</text>
                
                <circle cx="100" cy="75" r="20" fill="none" stroke="#3b82f6" strokeWidth="2" />
                <text x="93" y="80" fontSize="14" fill="#3b82f6" fontWeight="bold">V<tspan fontSize="10" dy="2">th</tspan></text>
                
                <line x1="120" y1="75" x2="140" y2="75" stroke="#475569" strokeWidth="2" />
                <rect x="140" y="65" width="40" height="20" fill="none" stroke="#10b981" strokeWidth="2" />
                <text x="150" y="80" fontSize="12" fill="#10b981" fontWeight="bold">R<tspan fontSize="9" dy="2">th</tspan></text>
                
                <line x1="180" y1="75" x2="230" y2="75" stroke="#475569" strokeWidth="2" />
                <text x="230" y="85" fontSize="12" fill="#94a3b8">-</text>
                
                <text x="30" y="110" fontSize="11" fill="#64748b">{(result as TheveninResult).port.positive}</text>
                <text x="220" y="110" fontSize="11" fill="#64748b">{(result as TheveninResult).port.negative}</text>
              </svg>
            </div>
          </div>
        ) : isDcTable ? (
          <div className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-lg font-medium text-slate-200">
                {isDcOpResult
                  ? '直流工作点'
                  : isBranchCurrentResult
                    ? '支路电流'
                    : isMeshCurrentResult
                      ? '网孔电流'
                      : '节点电压'}
                结果
              </h3>
              {isDcOpResult && (
                <p className="text-xs text-slate-500">
                  直流工作点（电容开路 / 电感短路 / 交流源取直流分量）
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showBranch} onChange={(e) => setShowBranch(e.target.checked)} />
                显示支路电流
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showNode} onChange={(e) => setShowNode(e.target.checked)} />
                显示节点电压
              </label>
            </div>
            
            {teachingResult?.steps && teachingResult.steps.length > 0 && (
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-slate-300 mb-3">求解步骤</h4>
                <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-400">
                  {teachingResult.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                
                {teachingResult.matrices && (
                   <div className="mt-6 space-y-4">
                    {teachingResult.matrices.step2 && (
                      <div>
                        <MatrixDisplay
                          label="G 矩阵"
                          data={teachingResult.matrices.step2.G}
                          rowLabels={teachingResult.matrices.step2.nodes}
                          columnLabels={teachingResult.matrices.step2.nodes}
                        />
                        <VectorDisplay
                          label="I 向量"
                          data={teachingResult.matrices.step2.I}
                          labels={teachingResult.matrices.step2.nodes}
                        />
                      </div>
                    )}
                    {teachingResult.matrices.step6 && (
                      <VectorDisplay
                        label="V 求解结果"
                        data={teachingResult.matrices.step6.V}
                        labels={teachingResult.matrices.step6.nodes}
                      />
                    )}
                   </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Branch Currents Table */}
              {showBranch && (result as BranchCurrentResult).branch_currents && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">支路电流</h4>
                  <div className="overflow-hidden rounded-lg border border-slate-700">
                    <VirtualTable entries={Object.entries((result as BranchCurrentResult).branch_currents)} columns={["支路", "电流 (A)"]} />
                  </div>
                </div>
              )}

              {/* Node Voltages Table */}
              {showNode && (result as NodeVoltageResult).node_voltages && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">节点电压</h4>
                  <div className="overflow-hidden rounded-lg border border-slate-700">
                    <VirtualTable entries={Object.entries((result as NodeVoltageResult).node_voltages)} columns={["节点", "电压 (V)"]} />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : hasSignals && isTransientResult ? (
          <div className="space-y-4">
            {diagramMode === 'mixed' && (
              <p className="text-[11px] text-slate-500">
                混合仿真为准静态耦合：电路侧仅支持纯电阻，L/C 动态不参与
              </p>
            )}
            {(result as SimulationData).signals.map((signal) => (
              <StepResponseChart
                key={signal.id}
                time={(result as SimulationData).time}
                signal={signal}
                metrics={transientMetrics?.[signal.id]}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Activity className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm">暂无仿真结果</p>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div 
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10"
        onMouseDown={handleMouseDownResize}
      >
        <div className="absolute bottom-1 right-1 w-2 h-2 border-r-2 border-b-2 border-slate-600"></div>
      </div>
    </motion.div>
  )
}
