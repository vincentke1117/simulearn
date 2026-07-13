// 结果格式化（纯函数，单测在 format.test.ts）。数字一律带单位与有效位——教学场景要能直接读数。

import type { N1Entry, ShortCircuitEntry } from '../types';

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * HTML 转义：节点/支路 id 来自学生自己写或互传的 .json，一律不可信。
 * 凡是把 id / 后端 message 拼进 innerHTML 的地方都必须过一遍这个函数。
 */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

/**
 * N-1 表格的「失负荷」单元格。
 * 后端 analysis.jl::execute_n1 只在 islanding 行给 lost_load_mw；
 * ok 行确定无失负荷（0）；diverged 行只有 {branch, outcome}，失负荷是**未知**而不是 0——
 * 写成 0.000 会让学生读成「这条开断没损失」。
 */
export function n1LostLoadCell(entry: N1Entry): string {
  if (entry.outcome === 'ok') return '0.000';
  if (entry.outcome === 'islanding') return fmt(entry.lost_load_mw, 3);
  return '未知';
}

export function fmt(value: number | null | undefined, digits = 3): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

/** 大数用科学计数，避免把「理想电源」的 4.6e5 kA 撑爆表格。 */
export function fmtSci(value: number | null | undefined, digits = 3): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e5 || abs < 1e-3)) return value.toExponential(2);
  return value.toFixed(digits);
}

export function fmtKw(mw: number | null | undefined, digits = 1): string {
  return typeof mw === 'number' && Number.isFinite(mw) ? `${(mw * 1000).toFixed(digits)} kW` : '—';
}

/** Zth = r + jx（pu），r 或 x 极小时用科学计数保住信息量。 */
export function fmtZth(z: { r: number; x: number }): string {
  const part = (v: number) => (Math.abs(v) < 1e-4 && v !== 0 ? v.toExponential(1) : v.toFixed(5));
  return `${part(z.r)} + j${part(z.x)}`;
}

/** slack 的 Zth 约定为 j·1e-6（理想无穷大电源），|Zth| 极小即判定为约定产物。 */
export const IDEAL_SOURCE_Z_PU = 1e-5;

export function zMagnitude(z: { r: number; x: number }): number {
  return Math.hypot(z.r, z.x);
}

/**
 * 该母线的短路结果是不是「理想电源约定」的产物（而非物理真值）。
 * 判据：|Zth| < 1e-5 pu（后端 SOURCE_X_PU = 1e-6），或它就是 slack 母线且阻抗近零。
 */
export function isIdealSourceRow(row: ShortCircuitEntry, slackBusId?: string | null): boolean {
  if (zMagnitude(row.zth_pu) < IDEAL_SOURCE_Z_PU) return true;
  // 兜底：slack 母线且短路电流大到不物理（> 1e4 pu）也按约定产物处理
  return row.bus === slackBusId && row.i_f_pu > 1e4;
}

export const IDEAL_SOURCE_NOTE = '理想电源（无穷大短路容量），非真实值';

/**
 * 短路电流热力色标：**排除理想电源行**后再定标——否则 slack 的 4.6e5 kA 会把
 * 其余 32 条母线全部挤进同一个颜色。返回 null 表示无有效样本。
 */
export function heatDomain(rows: ShortCircuitEntry[], slackBusId?: string | null): [number, number] | null {
  const values = rows.filter((r) => !isIdealSourceRow(r, slackBusId)).map((r) => r.i_f_ka).filter(Number.isFinite);
  if (values.length === 0) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return [lo, hi];
}

/** 低电流=蓝、高电流=红的连续色标（domain 退化时返回中间色）。 */
export function heatColor(value: number, domain: [number, number] | null): string {
  if (!domain || !Number.isFinite(value)) return '#94a3b8';
  const [lo, hi] = domain;
  const t = hi - lo < 1e-12 ? 0.5 : Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  // 蓝 (37,99,235) → 琥珀 (217,119,6) → 红 (220,38,38)
  const stops: Array<[number, [number, number, number]]> = [
    [0, [37, 99, 235]],
    [0.55, [217, 119, 6]],
    [1, [220, 38, 38]],
  ];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i += 1;
  const [t0, c0] = stops[i];
  const [t1, c1] = stops[i + 1];
  const k = (t - t0) / (t1 - t0 || 1);
  const mix = c0.map((c, j) => Math.round(c + (c1[j] - c) * k));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

/** 概览里的「最大短路电流母线」若落在理想电源上，必须说明。 */
export function summarizeMaxBus(
  rows: ShortCircuitEntry[],
  maxBus: string,
  slackBusId?: string | null,
): { bus: string; ideal: boolean } {
  const row = rows.find((r) => r.bus === maxBus);
  return { bus: maxBus, ideal: row ? isIdealSourceRow(row, slackBusId) : false };
}

/** 排除理想电源后的真实最大短路电流母线（教学上真正想看的那条）。 */
export function realMaxRow(rows: ShortCircuitEntry[], slackBusId?: string | null): ShortCircuitEntry | null {
  const real = rows.filter((r) => !isIdealSourceRow(r, slackBusId));
  if (real.length === 0) return null;
  return real.reduce((a, b) => (b.i_f_ka > a.i_f_ka ? b : a));
}

export const N1_OUTCOME_LABEL: Record<string, string> = {
  ok: '收敛',
  islanding: '孤岛',
  diverged: '不收敛',
};

// ---------------------------------------------------------------- OPF / LMP

/** 金额：元/h 与 元/MWh 统一保留两位（教学上要能直接对账）。 */
export function fmtYuan(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export interface LmpDomain {
  lo: number;
  hi: number;
  /** true = 全网 LMP 实质相等（无阻塞、网损可忽略）：色标退化，不能拿颜色骗人。 */
  flat: boolean;
  /** 相对极差 (hi-lo)/max(|hi|,|lo|,eps)。 */
  rel: number;
}

/**
 * LMP 相对极差小于千分之一即视为「全网同价」。
 * 依据：econ2（无阻塞、线路阻抗 1e-4 pu）实测 LMP 12.285756 → 12.287029，相对极差 1.0e-4 ——
 * 这点差异纯粹是边际网损分量，把它拉满整条蓝→红色标会让学生以为存在显著价差。
 * IEEE33 相对极差 12.8%（1.0000 → 1.1472），远在阈值之上，正常上色。
 */
export const LMP_FLAT_REL = 1e-3;

/** LMP 色标定标。返回 null 表示没有有效样本（不能上色，也不能画图例）。 */
export function lmpDomain(values: Array<number | null | undefined>): LmpDomain | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const scale = Math.max(Math.abs(hi), Math.abs(lo), 1e-12);
  const rel = (hi - lo) / scale;
  return { lo, hi, flat: rel < LMP_FLAT_REL, rel };
}

/** 色标退化（flat / null）时统一返回中性灰，绝不整片同色却配一条误导性的蓝→红图例。 */
export function lmpColor(value: number, domain: LmpDomain | null): string {
  if (!domain || domain.flat) return '#94a3b8';
  return heatColor(value, [domain.lo, domain.hi]);
}

/** 是否是边际机组：未顶限（binding=false）⇒ 它在定价，其边际成本应当等于所在母线的 LMP。 */
export function isMarginalGen(gen: { binding: boolean }): boolean {
  return !gen.binding;
}

/** 机组边际成本与所在母线 LMP 是否相等（相对误差 < 1e-4）——「边际机组在定价」这条关系的可视化判据。 */
export function marginalMatchesLmp(
  marginalCost: number,
  lmp: number | undefined,
  relTol = 1e-4,
): boolean {
  if (typeof lmp !== 'number' || !Number.isFinite(lmp) || !Number.isFinite(marginalCost)) return false;
  const scale = Math.max(Math.abs(lmp), 1e-9);
  return Math.abs(marginalCost - lmp) / scale < relTol;
}

/**
 * 这台机组用的是不是后端的**默认成本曲线**（c₂=0, c₁=1, c₀=0）。
 * 后端 optimization.jl 在机组没给成本系数时硬编码这条曲线，于是它会变成"全网最便宜的机组"
 * 并被优先顶到 Pmax —— 结果表看上去权威，实际上这台机的价格是凭空造出来的。
 * 只要命中就必须在表里标出来（学生最常见的错误是只给一台机填成本）。
 */
export function isDefaultCostCurve(gen: { cost_c2: number; cost_c1: number; cost_c0: number }): boolean {
  return gen.cost_c2 === 0 && gen.cost_c1 === 1 && gen.cost_c0 === 0;
}

/** 机组顶限状态标签：at_pmin / at_pmax / 未顶限。 */
export function bindingLabel(gen: { binding: boolean; at_pmin: boolean; at_pmax: boolean }): string {
  if (!gen.binding) return '未顶限';
  if (gen.at_pmax) return '顶上限 Pmax';
  if (gen.at_pmin) return '顶下限 Pmin';
  return '顶限';
}

// ---------------------------------------------------------------- N-1 转供恢复

/**
 * 转供恢复表的「恢复后」单元格。不可恢复的条目里 loss_mw / vmin_pu / violated / radial 等
 * 一律是 **null**（不是 0）——写成 0.000 会让学生读成「恢复后零网损」。
 */
export function restoreCell(value: number | null | undefined, digits = 3): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

/** 恢复后是否「能供上电但供不好」：全部恢复供电，却出现电压/过载越限。这是本分析的教学高潮。 */
export function isRestoredButViolated(entry: {
  restorable: boolean;
  fully_restored: boolean;
  violated: boolean | null;
}): boolean {
  return entry.restorable && entry.fully_restored && entry.violated === true;
}
