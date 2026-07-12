import type {
  AcPhasorResult,
  AnalysisResultData,
  BranchCurrentResult,
  ComparisonResult,
  DcOpResult,
  FrequencySweepResult,
  MeshCurrentResult,
  NodeVoltageResult,
  SimulationData,
  TheveninResult,
} from '@/types/circuit'

/**
 * 结果面板的分派判别器。
 *
 * 历史 BUG：面板按 `method === 'node_voltage'` 之类硬匹配分派，后端新增 dc_op / ac_phasor /
 * frequency_sweep 后所有分支都不命中，学生点了运行、后端算对了、面板却显示"暂无仿真结果"。
 *
 * 修法：**以结果结构为主、method 仅用于消歧**。任何带 node_voltages 的标量结果都会落到直流表格分支，
 * 因此后端未来再加同构方法也不会掉进空态。
 */
export type DcSolveMethod = 'node_voltage' | 'branch_current' | 'mesh_current'

export type ResultKind =
  | { kind: 'empty' }
  | { kind: 'transient'; data: SimulationData }
  | { kind: 'thevenin'; data: TheveninResult }
  | { kind: 'frequency_sweep'; data: FrequencySweepResult }
  | { kind: 'ac_phasor'; data: AcPhasorResult }
  | { kind: 'dc_op'; data: DcOpResult }
  | { kind: 'dc_solve'; method: DcSolveMethod; data: NodeVoltageResult | BranchCurrentResult | MeshCurrentResult }
  | { kind: 'comparison'; data: ComparisonResult }

const COMPARISON_METHOD_KEYS = ['node_voltage', 'branch_current', 'mesh_current', 'thevenin']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasKeys = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => key in value)

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'number')

export function isTransientData(value: unknown): value is SimulationData {
  return isRecord(value) && isNumberArray(value.time) && Array.isArray(value.signals)
}

export function isTheveninData(value: unknown): value is TheveninResult {
  return isRecord(value) && typeof value.vth === 'number' && typeof value.rth === 'number'
}

export function isFrequencySweepData(value: unknown): value is FrequencySweepResult {
  return isRecord(value) && isNumberArray(value.freq_hz) && isRecord(value.probes)
}

export function isAcPhasorData(value: unknown): value is AcPhasorResult {
  return (
    isRecord(value) &&
    typeof value.frequency_hz === 'number' &&
    hasKeys(value, ['node_voltages', 'node_phases_deg', 'branch_currents', 'branch_phases_deg'])
  )
}

export function hasNodeVoltagesTable(value: unknown): value is DcOpResult {
  return isRecord(value) && isRecord(value.node_voltages)
}

function isComparisonData(value: unknown): value is ComparisonResult {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length === 0) return false
  return keys.every((key) => COMPARISON_METHOD_KEYS.includes(key))
}

/**
 * 相量结果判别（ac_phasor / 任何带 *_phases_deg 的结果）。
 *
 * 关键：ac_phasor 的 `node_voltages` 是**相量幅值**，不是实数电位。画布叠加层（mapping.ts）
 * 对元件压降做的是标量减法 |V₊| − |V₋|，对相量是错的：
 *   RC 低通 5 V∠0° @1kHz，n1 = 5∠0°、n2 = 3.5355∠−45°
 *   标量相减 → 5 − 3.5355 = 1.465 V（错）
 *   复数相减 → |5∠0° − 3.5355∠−45°| = |2.5 + j2.5| = 3.536 V（真值）
 * 更糟的是错值还满足朴素 KVL 心算（1.465 + 3.536 ≈ 5），学生不会怀疑。
 * 因此相量结果一律不进叠加层——读数交给 AcPhasorView 的幅值∠相角表与相量图。
 */
export function isPhasorData(value: unknown): boolean {
  return isRecord(value) && ('node_phases_deg' in value || 'branch_phases_deg' in value)
}

/** 该结果是否可以安全地灌进画布电压/电流叠加层（只有实数标量结果可以） */
export function supportsVoltageOverlay(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (isPhasorData(value)) return false
  if (isFrequencySweepData(value)) return false
  if (isTransientData(value)) return false
  return true
}

/**
 * @param method 后端回显 / 前端请求的分析方法（可能为空 —— 缓存回放、旧结果）
 * @param data   统一封套里的 data
 */
export function classifyResult(method: string | undefined, data: AnalysisResultData | null): ResultKind {
  if (!isRecord(data)) return { kind: 'empty' }

  // 结构优先：这些形状彼此互斥，不依赖 method 就能认出来
  if (isTransientData(data)) return { kind: 'transient', data }
  if (isTheveninData(data)) return { kind: 'thevenin', data }
  if (isFrequencySweepData(data)) return { kind: 'frequency_sweep', data }
  if (isAcPhasorData(data)) return { kind: 'ac_phasor', data }

  // 标量直流结果：dc_op 与节点/支路/网孔法同构，只能靠 method 区分标题与语义
  if (hasNodeVoltagesTable(data)) {
    if (method === 'dc_op') return { kind: 'dc_op', data }
    if (method === 'branch_current' || method === 'mesh_current' || method === 'node_voltage') {
      return { kind: 'dc_solve', method, data: data as NodeVoltageResult }
    }
    // method 缺失或未知：仍然渲染表格（保底），绝不掉进空态
    return { kind: 'dc_solve', method: 'node_voltage', data: data as NodeVoltageResult }
  }

  if (isComparisonData(data)) return { kind: 'comparison', data }

  return { kind: 'empty' }
}
