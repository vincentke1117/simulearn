import Plot from 'react-plotly.js'
import type { Data, Layout } from 'plotly.js'

import type { FrequencySweepResult } from '@/types/circuit'

const PROBE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']

export interface BodePlotProps {
  result: FrequencySweepResult
  height?: number
}

/**
 * 探针幅频/相频双子图：上幅频（dB）、下相频（°），横轴统一对数刻度。
 * 每个探针一条曲线，图例用探针 id（与画布上的探针标签一致）。
 *
 * 重要：后端 `probes[*].mag` 是探针处的**绝对幅值**（电压探针 V、电流探针 A，均为峰值），
 * `mag_db = 20·log₁₀(|X| / 1 单位)`，**不是**传递函数 |H| = Vout/Vin。
 * 源幅值 ≠ 1 时二者相差 20·log₁₀(源幅值) dB（RC 低通、5 V 源在 fc 处读到 +10.97 dB 而不是 −3.01 dB）。
 * 因此这里一律按「探针幅值」标注，不写 |H|、不写 ∠H。
 */
export function BodePlot({ result, height = 460 }: BodePlotProps) {
  const probeIds = Object.keys(result.probes)
  const freq = result.freq_hz

  const traces: Data[] = []
  probeIds.forEach((probeId, index) => {
    const color = PROBE_COLORS[index % PROBE_COLORS.length]
    const curve = result.probes[probeId]
    traces.push({
      x: freq,
      y: curve.mag_db,
      type: 'scatter',
      mode: 'lines',
      name: probeId,
      legendgroup: probeId,
      line: { color, width: 2 },
      xaxis: 'x',
      yaxis: 'y',
      hovertemplate: `${probeId}<br>f = %{x:.4g} Hz<br>幅值 = %{y:.3f} dB（绝对值，峰值）<extra></extra>`,
    })
    traces.push({
      x: freq,
      y: curve.phase_deg,
      type: 'scatter',
      mode: 'lines',
      name: probeId,
      legendgroup: probeId,
      showlegend: false,
      line: { color, width: 2 },
      xaxis: 'x2',
      yaxis: 'y2',
      hovertemplate: `${probeId}<br>f = %{x:.4g} Hz<br>相角 = %{y:.2f}°<extra></extra>`,
    })
  })

  const axisFont = { size: 10, color: '#94a3b8' }
  const tickFont = { size: 10, color: '#64748b' }

  const layout: Partial<Layout> = {
    autosize: true,
    height,
    margin: { l: 56, r: 16, t: 24, b: 44 },
    grid: { rows: 2, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    showlegend: true,
    legend: { font: { size: 10, color: '#cbd5e1' }, orientation: 'h', y: 1.14, x: 0 },
    xaxis: {
      type: 'log',
      gridcolor: '#334155',
      zeroline: false,
      tickfont: tickFont,
      showticklabels: true,
      domain: [0, 1],
    },
    yaxis: {
      title: { text: '探针幅值 (dB)', font: axisFont },
      gridcolor: '#334155',
      zeroline: true,
      zerolinecolor: '#475569',
      tickfont: tickFont,
      domain: [0.56, 1],
    },
    xaxis2: {
      type: 'log',
      title: { text: '频率 (Hz)', font: axisFont },
      gridcolor: '#334155',
      zeroline: false,
      tickfont: tickFont,
      domain: [0, 1],
    },
    yaxis2: {
      title: { text: '探针相角 (°)', font: axisFont },
      gridcolor: '#334155',
      zeroline: true,
      zerolinecolor: '#475569',
      tickfont: tickFont,
      domain: [0, 0.44],
    },
  }

  return (
    <Plot
      data={traces}
      layout={layout}
      config={{ responsive: true, displaylogo: false }}
      useResizeHandler
      style={{ width: '100%', height: `${height}px` }}
    />
  )
}
