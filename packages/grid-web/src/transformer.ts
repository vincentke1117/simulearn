/**
 * 变压器分接头与电容组的教材语义（第十二章调压）。与后端 topology.jl 的 transformer_branch 约定一致：
 * from = 高压侧母线，hv_kv 为分接头中心电压，挡位 tap_pos ∈ [−tap_steps, +tap_steps]，
 * 分接头电压 U_tap = hv_kv·(1 + tap_pos·tap_step_pct/100)。
 */

export interface TransformerParams {
  hv_kv?: unknown;
  lv_kv?: unknown;
  tap_step_pct?: unknown;
  tap_steps?: unknown;
  tap_pos?: unknown;
}

const num = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function tapKv(p: TransformerParams, pos: number = num(p.tap_pos)): number {
  return num(p.hv_kv) * (1 + (pos * num(p.tap_step_pct)) / 100);
}

/** 挡位下拉选项：−2（104.50 kV）… 0（110.00 kV，额定）… +2（115.50 kV） */
export function tapOptions(p: TransformerParams): { value: string; label: string }[] {
  const steps = Math.max(0, Math.floor(num(p.tap_steps)));
  const options: { value: string; label: string }[] = [];
  for (let pos = -steps; pos <= steps; pos += 1) {
    const sign = pos > 0 ? '+' : '';
    const note = pos === 0 ? '，额定' : '';
    options.push({ value: String(pos), label: `${sign}${pos} 挡（${tapKv(p, pos).toFixed(2)} kV${note}）` });
  }
  return options;
}

/** 画布上的变压器标注：「107.25/6.3 kV」 */
export function transformerLabel(p: TransformerParams): string {
  return `${trimKv(tapKv(p))}/${trimKv(num(p.lv_kv))} kV`;
}

const trimKv = (kv: number): string => String(Number(kv.toFixed(2)));

export interface CapacitorParams {
  q_unit_kvar?: unknown;
  groups?: unknown;
}

/** 电容组投入组数下拉选项：「0 组（0 Mvar）」…「4 组（8 Mvar）」，容量按额定电压计 */
export function capacitorOptions(p: CapacitorParams): { value: string; label: string }[] {
  const groups = Math.max(0, Math.floor(num(p.groups)));
  const unitMvar = num(p.q_unit_kvar) / 1000;
  const options: { value: string; label: string }[] = [];
  for (let n = 0; n <= groups; n += 1) {
    options.push({ value: String(n), label: `${n} 组（${Number((n * unitMvar).toFixed(3))} Mvar）` });
  }
  return options;
}
