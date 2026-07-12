// 参数条的解析与校验（纯函数，单测在 params.test.ts）。
// 校验规则与 Julia 侧 parse_timeseries_request / parse_shortcircuit_request /
// parse_transient_request 一一对应：前端先拦一道，学生看到的是中文提示而不是 422。

import type { TransientFault, TransientSim } from '../types';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** 与后端 MAX_TIMESERIES_POINTS 对齐。 */
export const MAX_TIMESERIES_POINTS = 96;
/** 与后端 MAX_SIM_STEPS / CCT_SEARCH_WINDOW_S 对齐。 */
export const MAX_SIM_STEPS = 200_000;
const CCT_SEARCH_WINDOW_S = 1.0;

/** "0.5, 0.8 1.0\n1.2" → [0.5, 0.8, 1.0, 1.2]，逗号/空格/换行/分号均可分隔。 */
export function parseLoadScale(raw: string): Parsed<number[]> {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return { ok: false, error: '负荷倍数序列不能为空（至少 1 个点）' };
  if (tokens.length > MAX_TIMESERIES_POINTS) {
    return { ok: false, error: `负荷倍数最多 ${MAX_TIMESERIES_POINTS} 个点，当前 ${tokens.length} 个` };
  }
  const values: number[] = [];
  for (const token of tokens) {
    const num = Number(token);
    if (!Number.isFinite(num)) return { ok: false, error: `无法解析为数字：「${token}」` };
    if (num <= 0) return { ok: false, error: `负荷倍数必须为正数，收到 ${num}` };
    values.push(num);
  }
  return { ok: true, value: values };
}

/** 典型日 24 点负荷曲线（教学用，双峰）。 */
export function typicalDayScale(): number[] {
  return [
    0.55, 0.5, 0.47, 0.45, 0.46, 0.52, 0.65, 0.78, 0.88, 0.95, 0.98, 1.0, 0.97, 0.94, 0.93, 0.96, 1.02, 1.12, 1.2, 1.15,
    1.05, 0.92, 0.75, 0.62,
  ];
}

export interface ShortCircuitParams {
  fault_bus: string | null;
  zf_pu: number;
}

/** fault_bus 为空字符串 → null（全网扫描）。 */
export function parseShortCircuitParams(input: { faultBus: string; zf: string }): Parsed<ShortCircuitParams> {
  const zfRaw = input.zf.trim();
  const zf = zfRaw === '' ? 0 : Number(zfRaw);
  if (!Number.isFinite(zf)) return { ok: false, error: '过渡电阻 zf 必须是有限数字' };
  if (zf < 0) return { ok: false, error: '过渡电阻 zf 不能为负' };
  const bus = input.faultBus.trim();
  return { ok: true, value: { fault_bus: bus === '' ? null : bus, zf_pu: zf } };
}

export interface TransientParams {
  fault: TransientFault;
  sim: TransientSim;
  f_hz: number;
  find_cct: boolean;
}

export interface TransientInput {
  faultBus: string;
  tFault: string;
  tClear: string;
  zf: string;
  tripBranch: string;
  tStop: string;
  dt: string;
  fHz?: string;
  findCct: boolean;
}

function num(raw: string, fallback: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function parseTransientParams(input: TransientInput): Parsed<TransientParams> {
  const bus = input.faultBus.trim();
  if (bus === '') return { ok: false, error: '暂态分析必须指定故障母线' };

  const tFault = num(input.tFault, 0.1);
  const tClear = num(input.tClear, 0.25);
  const zf = num(input.zf, 0);
  const tStop = num(input.tStop, 3);
  const dt = num(input.dt, 0.001);
  const fHz = num(input.fHz ?? '', 50);
  if (tFault === null || tClear === null || zf === null || tStop === null || dt === null || fHz === null) {
    return { ok: false, error: '暂态参数必须都是有限数字' };
  }
  if (tFault < 0) return { ok: false, error: '故障发生时刻 t_fault 不能为负' };
  if (!(tClear > tFault)) return { ok: false, error: `切除时刻 t_clear (${tClear} s) 必须大于故障时刻 t_fault (${tFault} s)` };
  if (zf < 0) return { ok: false, error: '过渡电阻 zf 不能为负' };
  if (!(dt > 0)) return { ok: false, error: '积分步长 dt 必须为正' };
  if (tStop < tClear) return { ok: false, error: `仿真时长 t_stop (${tStop} s) 不能小于切除时刻 t_clear (${tClear} s)` };
  if (!(fHz > 0)) return { ok: false, error: '系统频率 f_hz 必须为正' };

  // 与后端相同的步数上限（CCT 搜索会把窗口延长到 t_fault + 1.0 + 1.5 s）
  const horizon = Math.max(tStop, tFault + CCT_SEARCH_WINDOW_S + 1.5);
  if (horizon / dt > MAX_SIM_STEPS) {
    return {
      ok: false,
      error: `仿真步数 ${Math.round(horizon / dt)} 超过上限 ${MAX_SIM_STEPS}：请增大 dt 或减小 t_stop`,
    };
  }

  const trip = input.tripBranch.trim();
  return {
    ok: true,
    value: {
      fault: {
        bus,
        t_fault_s: tFault,
        t_clear_s: tClear,
        zf_pu: zf,
        trip_branch: trip === '' ? null : trip,
      },
      sim: { t_stop_s: tStop, dt_s: dt },
      f_hz: fHz,
      find_cct: input.findCct,
    },
  };
}
