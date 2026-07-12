import type { StepResponseMetrics } from '@/types/circuit'

/**
 * 教学场景的读数格式化：数字必须带单位与合理有效位，学生要能直接读。
 *
 * 约定：
 * - 幅值在 [0.1, 1000) 区间用基本单位直读（0.7071 V），超出该区间自动切 SI 词头（707.1 µA / 1.000 kHz），
 *   避免出现 0.0007071 A 这种没法读的数。
 * - 相角固定两位小数（-45.00°），与相量图刻度对齐。
 */

const SI_PREFIXES: { factor: number; prefix: string }[] = [
  { factor: 1e9, prefix: 'G' },
  { factor: 1e6, prefix: 'M' },
  { factor: 1e3, prefix: 'k' },
  { factor: 1, prefix: '' },
  { factor: 1e-3, prefix: 'm' },
  { factor: 1e-6, prefix: 'µ' },
  { factor: 1e-9, prefix: 'n' },
  { factor: 1e-12, prefix: 'p' },
]

const BASE_LOW = 0.1
const BASE_HIGH = 1e3

function withUnit(text: string, unit: string) {
  return unit ? `${text} ${unit}` : text
}

/** 有效数字格式化（保留末尾 0，读起来稳定：1.000 / 250.0 / 0.7071） */
export function toSignificant(value: number, digits = 4): string {
  return value.toPrecision(digits)
}

/**
 * 工程记数法：自动挑 SI 词头，把数字压进人能读的量级。
 * @param unit 基本单位（'V' / 'A' / 'W' / 's' …），传空串则不附单位
 */
export function formatEngineering(value: number, unit = '', digits = 4): string {
  if (!Number.isFinite(value)) return withUnit('—', unit)
  if (value === 0) return withUnit('0', unit)

  const abs = Math.abs(value)
  // 无量纲量（指标里的峰值/稳态值）没有词头可挂，直接给有效数字
  if (!unit || (abs >= BASE_LOW && abs < BASE_HIGH)) {
    return withUnit(toSignificant(value, digits), unit)
  }

  const entry = SI_PREFIXES.find((candidate) => abs >= candidate.factor) ?? SI_PREFIXES[SI_PREFIXES.length - 1]
  const scaled = value / entry.factor
  return `${toSignificant(scaled, digits)} ${entry.prefix}${unit}`
}

/** 相角：固定两位小数，带度符号 */
export function formatPhaseDeg(phaseDeg: number): string {
  if (!Number.isFinite(phaseDeg)) return '—'
  // -0 会打印成 "-0.00"，规范化掉
  const normalized = Object.is(phaseDeg, -0) ? 0 : phaseDeg
  return `${normalized.toFixed(2)}°`
}

/** 相量读数："0.7071 V ∠ -45.00°" —— 交流电路的标准板书写法 */
export function formatPhasor(magnitude: number, phaseDeg: number, unit: string, digits = 4): string {
  return `${formatEngineering(magnitude, unit, digits)} ∠ ${formatPhaseDeg(phaseDeg)}`
}

export function formatFrequency(hz: number): string {
  return formatEngineering(hz, 'Hz')
}

export function formatSeconds(seconds: number): string {
  return formatEngineering(seconds, 's')
}

export function formatPercent(pct: number, digits = 2): string {
  if (!Number.isFinite(pct)) return '—'
  return `${pct.toFixed(digits)} %`
}

/** 功率因数：无量纲，四位小数；附带感性/容性提示由调用方按 Q 决定 */
export function formatPowerFactor(pf: number): string {
  if (!Number.isFinite(pf)) return '—'
  return pf.toFixed(4)
}

/** 无功性质：Q>0 感性（电流滞后电压），Q<0 容性（电流超前电压） */
export function reactiveNature(qVar: number): '感性' | '容性' | '纯阻性' {
  if (qVar > 0) return '感性'
  if (qVar < 0) return '容性'
  return '纯阻性'
}

export interface FormattedMetric {
  key: keyof StepResponseMetrics
  label: string
  value: string
  hint: string
}

/** 阶跃响应指标卡：控制课的六个经典读数 */
export function formatStepMetrics(metrics: StepResponseMetrics): FormattedMetric[] {
  return [
    { key: 'overshoot_pct', label: '超调量', value: formatPercent(metrics.overshoot_pct), hint: 'σ% = (峰值 − 稳态值)/稳态值' },
    { key: 'rise_time_s', label: '上升时间', value: formatSeconds(metrics.rise_time_s), hint: '10% → 90% 稳态值' },
    { key: 'settling_time_s', label: '调节时间', value: formatSeconds(metrics.settling_time_s), hint: '进入并保持 ±2% 误差带' },
    { key: 'peak_value', label: '峰值', value: formatEngineering(metrics.peak_value), hint: '响应最大值' },
    { key: 'peak_time_s', label: '峰值时刻', value: formatSeconds(metrics.peak_time_s), hint: '到达峰值的时间' },
    { key: 'final_value', label: '稳态值', value: formatEngineering(metrics.final_value), hint: 't → ∞ 的收敛值' },
  ]
}
