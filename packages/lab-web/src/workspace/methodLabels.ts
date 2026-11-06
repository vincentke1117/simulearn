import type { AnalysisMethod } from '@/types/circuit'

/**
 * 分析方法的显示名：工具栏下拉、案例列表与案例说明卡共用一张表，同一屏上不出现两种叫法。
 * 用词跟邱关源《电路》：结点电压法、戴维宁等效。
 */
export const ANALYSIS_METHOD_LABELS: Record<AnalysisMethod, string> = {
  transient: '瞬态分析 (Transient)',
  node_voltage: '结点电压法 (Node Voltage)',
  branch_current: '支路电流法 (Branch Current)',
  mesh_current: '网孔电流法 (Mesh Current)',
  thevenin: '戴维宁等效 (Thevenin)',
  dc_op: '直流工作点',
  ac_phasor: '正弦稳态（相量分析）',
  frequency_sweep: '频率扫描 (Bode)',
}

/** 不带英文括注的短名（案例列表的小标签用） */
export function shortMethodLabel(method: AnalysisMethod | string): string {
  const label = (ANALYSIS_METHOD_LABELS as Record<string, string>)[method]
  return label ? label.replace(/\s*\([A-Za-z ]+\)$/, '') : method
}
