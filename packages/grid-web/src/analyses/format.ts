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
