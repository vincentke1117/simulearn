import type { AnalysisResultData } from '@/types/circuit'
import type { ResultKind } from './resultKind'

function createTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/:/g, '-')
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

type CsvCell = string | number | null | undefined

function encodeCsvCell(value: CsvCell): string {
  const text = value == null ? '' : String(value)
  const safeText = typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText
}

function serializeCsvRows(rows: CsvCell[][]): string {
  if (rows.length === 0) return ''
  return `${rows.map((row) => row.map(encodeCsvCell).join(',')).join('\r\n')}\r\n`
}

export function serializeSimulationResultCSV(kind: ResultKind): string {
  const rows: CsvCell[][] = []

  if (kind.kind === 'ac_phasor') {
    const data = kind.data
    rows.push([`交流相量分析 (f = ${data.frequency_hz} Hz)`])
    rows.push(['节点', '电压幅值(V,峰值)', '电压相角(deg)'])
    Object.entries(data.node_voltages).forEach(([node, magnitude]) => {
      rows.push([node, magnitude, data.node_phases_deg[node] ?? 0])
    })
    rows.push([])
    rows.push(['支路', '电流幅值(A,峰值)', '电流相角(deg)'])
    Object.entries(data.branch_currents).forEach(([branch, magnitude]) => {
      rows.push([branch, magnitude, data.branch_phases_deg[branch] ?? 0])
    })
    if (data.power) {
      rows.push([])
      rows.push(['源', 'P(W)', 'Q(var)', 'S(VA)', '功率因数'])
      Object.entries(data.power.sources).forEach(([id, power]) => {
        rows.push([id, power.p_w, power.q_var, power.s_va, power.pf])
      })
      rows.push([])
      rows.push(['元件', '耗散P(W)'])
      Object.entries(data.power.elements).forEach(([id, power]) => {
        rows.push([id, power.p_w])
      })
      rows.push([])
      rows.push(['约定', data.power.convention])
    }
  } else if (kind.kind === 'frequency_sweep') {
    const data = kind.data
    const probeIds = Object.keys(data.probes)
    const header: CsvCell[] = ['频率(Hz)']
    probeIds.forEach((id) => {
      header.push(`${id}_mag`, `${id}_mag_dB`, `${id}_phase_deg`)
    })
    rows.push(header)
    data.freq_hz.forEach((frequency, index) => {
      const row: CsvCell[] = [frequency]
      probeIds.forEach((id) => {
        const curve = data.probes[id]
        row.push(curve.mag[index], curve.mag_db[index], curve.phase_deg[index])
      })
      rows.push(row)
    })
  } else if (kind.kind === 'dc_solve' || kind.kind === 'dc_op') {
    const data = kind.data
    if (data.node_voltages) {
      rows.push(['节点电压'])
      rows.push(['节点', '电压(V)'])
      Object.entries(data.node_voltages).forEach(([node, voltage]) => {
        rows.push([node, voltage])
      })
      rows.push([])
    }
    if (data.branch_currents) {
      rows.push(['支路电流'])
      rows.push(['支路', '电流(A)'])
      Object.entries(data.branch_currents).forEach(([branch, current]) => {
        rows.push([branch, current])
      })
    }
  } else if (kind.kind === 'thevenin') {
    const data = kind.data
    rows.push(['戴维南等效'])
    rows.push(['参数', '值'])
    rows.push(['Vth(V)', data.vth])
    rows.push(['Rth(Ω)', data.rth])
  } else if (kind.kind === 'transient') {
    const data = kind.data
    rows.push(['时间', ...data.signals.map((signal) => signal.label)])
    for (let index = 0; index < data.time.length; index += 1) {
      rows.push([data.time[index], ...data.signals.map((signal) => signal.values[index])])
    }
  }

  return serializeCsvRows(rows)
}

export function exportSimulationResultJSON(result: AnalysisResultData | null): void {
  if (!result) return
  const dataStr = JSON.stringify(result, null, 2)
  downloadBlob(
    new Blob([dataStr], { type: 'application/json' }),
    `simulation-result-${createTimestamp()}.json`,
  )
}

export function exportSimulationResultCSV(
  result: AnalysisResultData | null,
  kind: ResultKind,
): void {
  if (!result) return
  const csvContent = serializeSimulationResultCSV(kind)

  downloadBlob(
    new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }),
    `simulation-result-${createTimestamp()}.csv`,
  )
}

export async function exportSimulationResultPDF(result: AnalysisResultData | null): Promise<void> {
  if (!result) return

  const element = document.querySelector('.simulation-result-content') as HTMLElement
  if (!element) return

  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ])
    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: '#0f172a',
      logging: false,
      useCORS: true,
    })

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const imgWidth = 210
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
    pdf.save(`simulation-report-${createTimestamp()}.pdf`)
  } catch (error) {
    console.error('PDF export failed:', error)
    alert('导出PDF失败，请重试')
  }
}
