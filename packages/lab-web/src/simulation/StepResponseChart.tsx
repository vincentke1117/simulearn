import Plot from 'react-plotly.js'
import type { Data, Layout, Shape } from 'plotly.js'

import type { SimulationSignal, StepResponseMetrics } from '@/types/circuit'
import { formatStepMetrics } from './format'

export interface StepResponseChartProps {
  time: number[]
  signal: SimulationSignal
  /** 控制/混合仿真才有；纯电路瞬态没有 → 优雅降级为普通曲线 */
  metrics?: StepResponseMetrics
}

/** 指标卡：控制课的六个经典读数 */
function MetricCards({ metrics }: { metrics: StepResponseMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {formatStepMetrics(metrics).map((metric) => (
        <div
          key={metric.key}
          className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2"
          title={metric.hint}
        >
          <div className="text-[10px] uppercase tracking-wider text-slate-500">{metric.label}</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-100">{metric.value}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * 阶跃响应图：曲线 + 峰值点 + ±2% 稳态带 + 终值虚线。
 * 这是控制课的经典图，学生要能直接对着图读出超调、调节时间。
 */
export function StepResponseChart({ time, signal, metrics }: StepResponseChartProps) {
  const traces: Data[] = [
    {
      x: time,
      y: signal.values,
      type: 'scatter',
      mode: 'lines',
      name: signal.label ?? signal.id,
      line: { color: '#3b82f6', width: 2 },
      hovertemplate: 't = %{x:.4g} s<br>y = %{y:.4g}<extra></extra>',
    },
  ]

  const shapes: Partial<Shape>[] = []
  const annotations: Partial<Layout>['annotations'] = []

  if (metrics) {
    const tStart = time[0] ?? 0
    const tEnd = time[time.length - 1] ?? 1
    const band = Math.abs(metrics.final_value) * 0.02

    // ±2% 稳态带（半透明水平带）
    shapes.push({
      type: 'rect',
      xref: 'x',
      yref: 'y',
      x0: tStart,
      x1: tEnd,
      y0: metrics.final_value - band,
      y1: metrics.final_value + band,
      fillcolor: 'rgba(16, 185, 129, 0.12)',
      line: { width: 0 },
      layer: 'below',
    })

    // 终值虚线
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'y',
      x0: tStart,
      x1: tEnd,
      y0: metrics.final_value,
      y1: metrics.final_value,
      line: { color: '#10b981', width: 1, dash: 'dash' },
      layer: 'below',
    })

    // 调节时间竖线（y 用 paper 坐标，贯穿整幅）
    if (Number.isFinite(metrics.settling_time_s)) {
      shapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: metrics.settling_time_s,
        x1: metrics.settling_time_s,
        y0: 0,
        y1: 1,
        line: { color: '#f59e0b', width: 1, dash: 'dot' },
      })
      annotations.push({
        x: metrics.settling_time_s,
        y: 1,
        yref: 'paper',
        text: 'ts (±2%)',
        showarrow: false,
        font: { size: 9, color: '#f59e0b' },
        yanchor: 'bottom',
      })
    }

    // 峰值点
    traces.push({
      x: [metrics.peak_time_s],
      y: [metrics.peak_value],
      type: 'scatter',
      mode: 'markers',
      name: '峰值',
      marker: { color: '#ef4444', size: 9, symbol: 'circle-open', line: { width: 2 } },
      hovertemplate: `峰值 %{y:.4g}<br>t = %{x:.4g} s<extra></extra>`,
    })
  }

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 48, r: 12, t: 8, b: 34 },
    showlegend: false,
    shapes,
    annotations,
    xaxis: {
      title: { text: '时间 (s)', font: { size: 10, color: '#94a3b8' } },
      gridcolor: '#334155',
      tickfont: { size: 10, color: '#64748b' },
    },
    yaxis: {
      title: { text: '数值', font: { size: 10, color: '#94a3b8' } },
      gridcolor: '#334155',
      tickfont: { size: 10, color: '#64748b' },
    },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-800/50 p-3">
      <div className="px-1 text-xs font-semibold text-slate-300">{signal.label ?? signal.id}</div>
      {metrics ? (
        <MetricCards metrics={metrics} />
      ) : (
        <div className="px-1 text-[11px] text-slate-500">该结果不含阶跃响应指标（纯电路瞬态仿真不计算超调/调节时间）</div>
      )}
      <div className="h-64 w-full">
        <Plot
          data={traces}
          layout={layout}
          config={{ responsive: true, displaylogo: false }}
          useResizeHandler
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      {metrics && (
        <div className="px-1 text-[10px] text-slate-500">
          绿色带为 ±2% 稳态误差带，绿色虚线为终值，红圈为峰值点，橙色虚线为调节时间 t<sub>s</sub>
        </div>
      )}
    </div>
  )
}
