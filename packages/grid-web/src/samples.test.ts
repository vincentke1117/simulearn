// 契约回归：直接读 .samples/*.json（对着活后端抓下来的原样响应）作为地面真相，
// 逐键核对 types.ts 里的 OPF / N-1 类型。任何一侧漂移（后端加/删/改键、前端猜键名）都会在这里炸。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { N1RestorationEntry, N1Result, OpfBus, OpfGen, OpfResult } from './types';
import { isDefaultCostCurve, isRestoredButViolated, restoreCell } from './analyses/format';
import { lmpDomain } from './analyses/format';

function sample<T>(name: string): { http: number; body: { status: string; message: string; code?: string; path?: string[]; data: T | null } } {
  const url = new URL(`../../../.samples/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

const keys = (o: object) => Object.keys(o).sort();

describe('.samples 契约对齐 —— OPF', () => {
  const econ2 = sample<OpfResult>('grid-opf-econ2.json');
  const ieee33 = sample<OpfResult>('grid-opf-ieee33.json');

  it('封套是 ok，data.type = opf', () => {
    expect(econ2.http).toBe(200);
    expect(econ2.body.status).toBe('ok');
    expect(econ2.body.data!.type).toBe('opf');
  });

  it('gens 的键集合与 OpfGen 完全一致', () => {
    const expected = keys({
      id: '', bus: '', pg_mw: 0, qg_mvar: 0, pmin_mw: 0, pmax_mw: 0,
      cost_c0: 0, cost_c1: 0, cost_c2: 0, cost_yuan_per_h: 0,
      marginal_cost_yuan_per_mwh: 0, at_pmin: false, at_pmax: false, binding: false,
    } satisfies Record<keyof OpfGen, unknown>);
    for (const g of econ2.body.data!.gens) expect(keys(g)).toEqual(expected);
    for (const g of ieee33.body.data!.gens) expect(keys(g)).toEqual(expected);
  });

  it('buses 的键集合与 OpfBus 完全一致（BusResult + lmp_yuan_per_mwh）', () => {
    const expected = keys({
      id: '', vm_pu: 0, va_deg: 0, vmin_pu: 0, vmax_pu: 0, violation: null, lmp_yuan_per_mwh: 0,
    } satisfies Record<keyof OpfBus, unknown>);
    for (const b of econ2.body.data!.buses) expect(keys(b)).toEqual(expected);
  });

  it('summary 的键集合与 OpfSummary 完全一致', () => {
    expect(keys(econ2.body.data!.summary)).toEqual(
      keys({
        cost_total_yuan_per_h: 0, gen_total_mw: 0, load_total_mw: 0, loss_mw: 0,
        termination_status: '', solve_time_s: 0, vmin_pu: 0, vmin_bus: '',
        violation_buses: [], overloaded_branches: [],
        lmp_min_yuan_per_mwh: 0, lmp_min_bus: '', lmp_max_yuan_per_mwh: 0, lmp_max_bus: '',
      }),
    );
    expect(keys(econ2.body.data!.objective)).toEqual(
      keys({ termination_status: '', solve_time_s: 0, cost_total_yuan_per_h: 0 }),
    );
  });

  it('branches 与潮流 BranchResult 同构（可直接复用 paintResults）', () => {
    const expected = keys({
      id: '', p_mw: 0, q_mvar: 0, p_to_mw: 0, q_to_mvar: 0, loss_mw: 0,
      loading_pct: 0, status: 'CLOSED', overloaded: false,
    });
    for (const b of econ2.body.data!.branches) expect(keys(b)).toEqual(expected);
  });

  it('econ2：两机都不顶限 ⇒ 边际成本被拉平（等微增率），LMP 全网几乎相等 → 色标退化', () => {
    const d = econ2.body.data!;
    expect(d.gens.every((g) => !g.binding && !g.at_pmin && !g.at_pmax)).toBe(true);
    // 两台机的边际成本相差 < 1e-3 元/MWh —— 无阻塞时的等微增率解
    const [a, b] = d.gens.map((g) => g.marginal_cost_yuan_per_mwh);
    expect(Math.abs(a - b)).toBeLessThan(1e-3);
    const dom = lmpDomain(d.buses.map((x) => x.lmp_yuan_per_mwh))!;
    expect(dom.flat).toBe(true);
  });

  it('ieee33：LMP 从电源 1.0000 递增到末端 1.1472（边际网损分量）→ 色标正常', () => {
    const d = ieee33.body.data!;
    expect(d.summary.lmp_min_bus).toBe('bus-1');
    expect(d.summary.lmp_min_yuan_per_mwh).toBeCloseTo(1.0, 6);
    expect(d.summary.lmp_max_bus).toBe('bus-18');
    expect(d.summary.lmp_max_yuan_per_mwh).toBeCloseTo(1.1472, 4);
    const dom = lmpDomain(d.buses.map((x) => x.lmp_yuan_per_mwh))!;
    expect(dom.flat).toBe(false);
  });

  it('ieee33 的 grid-1 其实没填成本：后端回传的是默认曲线 c₂=0, c₁=1, c₀=0 —— LMP 的绝对值是假的，必须被前端标出来', () => {
    const g = ieee33.body.data!.gens[0];
    expect(g.id).toBe('grid-1');
    expect([g.cost_c2, g.cost_c1, g.cost_c0]).toEqual([0, 1, 0]);
    expect(g.marginal_cost_yuan_per_mwh).toBe(1);
    expect(isDefaultCostCurve(g)).toBe(true);
    // econ2 的两台机是真填了成本的，不能被误标
    for (const eg of econ2.body.data!.gens) expect(isDefaultCostCurve(eg)).toBe(false);
  });

  it('错误封套按 body.status 判错（HTTP 422 + GRID_VALIDATION + path）', () => {
    const err = sample<null>('grid-opf-error.json');
    expect(err.http).toBe(422);
    expect(err.body.status).toBe('error');
    expect(err.body.code).toBe('GRID_VALIDATION');
    expect(err.body.path).toEqual(['gen-1', 'bus']);
    expect(err.body.data).toBeNull();
  });
});

describe('.samples 契约对齐 —— N-1 转供恢复', () => {
  const n1 = sample<N1Result>('grid-n1-restore.json');
  const data = () => n1.body.data!;

  it('restoration 条目的键集合与 N1RestorationEntry 完全一致（可恢复/不可恢复同形）', () => {
    const expected = keys({
      branch: '', restorable: false, fully_restored: false, reason: null,
      islanded_buses: [], islanded_buses_after: [], lost_load_before_mw: 0, lost_load_after_mw: 0,
      candidate_ties: [], closed_ties: [], n_candidates_evaluated: 0,
      search_depth: 0, max_search_depth: 0, loss_mw: null, vmin_pu: null, vmin_bus: null,
      violated: null, violation_buses: [], overloaded_branches: [],
      radial: null, n_closed_branches: null, n_loops_base: 0, n_loops_after: null, n_bus: 0,
    } satisfies Record<keyof N1RestorationEntry, unknown>);
    for (const r of data().restoration!) expect(keys(r)).toEqual(expected);
    // 同形性：可恢复与不可恢复条目的键集合逐字相同
    const yes = data().restoration!.find((r) => r.restorable)!;
    const no = data().restoration!.find((r) => !r.restorable)!;
    expect(keys(yes)).toEqual(keys(no));
  });

  it('summary 多出 n_restorable / n_unrestorable / max_search_depth / n_loops_base（IEEE33 = 31/1/1/0）', () => {
    const s = data().summary;
    expect(s.n_restorable).toBe(31);
    expect(s.n_unrestorable).toBe(1);
    expect(s.max_search_depth).toBe(1);
    expect(s.n_loops_base).toBe(0);
    expect(s.n_branches).toBe(32);
    expect(s.n_islanding).toBe(32);
  });

  it('br-1（电源出线）不可恢复：恢复后字段是 null 而不是 0，且 5 条候选全部评估过', () => {
    const r = data().restoration!.find((x) => x.branch === 'br-1')!;
    expect(r.restorable).toBe(false);
    expect(r.fully_restored).toBe(false);
    expect(r.loss_mw).toBeNull();
    expect(r.vmin_pu).toBeNull();
    expect(r.violated).toBeNull();
    expect(r.radial).toBeNull();
    expect(r.n_closed_branches).toBeNull();
    expect(r.n_loops_after).toBeNull();
    expect(r.closed_ties).toEqual([]);
    expect(r.candidate_ties).toHaveLength(5);
    expect(r.n_candidates_evaluated).toBe(5);
    expect(r.reason).toContain('every tie has both ends inside the island');
    expect(r.lost_load_after_mw).toBeCloseTo(3.715, 6);
    // null 字段渲染成 '—'，绝不能是 '0.000'
    expect(restoreCell(r.loss_mw)).toBe('—');
    expect(restoreCell(r.vmin_pu, 4)).toBe('—');
  });

  it('br-2：完全恢复供电（3.255 → 0 MW）但 vmin 0.7456 严重越限 —— 「能供上电 ≠ 供得好」', () => {
    const r = data().restoration!.find((x) => x.branch === 'br-2')!;
    expect(r.restorable).toBe(true);
    expect(r.fully_restored).toBe(true);
    expect(r.closed_ties).toEqual(['br-33']);
    expect(r.lost_load_before_mw).toBeCloseTo(3.255, 6);
    expect(r.lost_load_after_mw).toBe(0);
    expect(r.vmin_pu!).toBeCloseTo(0.7456, 4);
    expect(r.vmin_bus).toBe('bus-33');
    expect(r.violated).toBe(true);
    expect(r.islanded_buses_after).toEqual([]);
    expect(isRestoredButViolated(r)).toBe(true);
  });

  it('不可恢复条目不会被误判成「能供上电但不合格」（violated=null 不是 true）', () => {
    const r = data().restoration!.find((x) => x.branch === 'br-1')!;
    expect(isRestoredButViolated(r)).toBe(false);
  });

  it('restorable ⇒ fully_restored（后端定理：不存在「部分恢复」）', () => {
    for (const r of data().restoration!) {
      if (r.restorable) expect(r.fully_restored).toBe(true);
    }
  });
});
