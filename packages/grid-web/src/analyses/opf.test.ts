// @vitest-environment jsdom
// OPF 视图与 LMP 色标。数据取自真实响应 .samples/grid-opf-{econ2,ieee33}.json。
import { beforeEach, describe, expect, it } from 'vitest';
import { renderOpf, opfLmpDomain } from './opf';
import {
  bindingLabel,
  fmtYuan,
  isDefaultCostCurve,
  isMarginalGen,
  lmpColor,
  lmpDomain,
  marginalMatchesLmp,
  LMP_FLAT_REL,
} from './format';
import type { OpfGen, OpfResult } from '../types';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

const gen = (over: Partial<OpfGen>): OpfGen => ({
  id: 'gen-1',
  bus: 'bus-1',
  pg_mw: 50,
  qg_mvar: 0,
  pmin_mw: 0,
  pmax_mw: 100,
  cost_c0: 0,
  cost_c1: 10,
  cost_c2: 0.02,
  cost_yuan_per_h: 550,
  marginal_cost_yuan_per_mwh: 12,
  at_pmin: false,
  at_pmax: false,
  binding: false,
  ...over,
});

/** econ2：两机经济调度，无阻塞，三母线 LMP 几乎相等（12.2858 → 12.2870）。 */
function econ2(): OpfResult {
  const summary = {
    cost_total_yuan_per_h: 1221.4854320616457,
    gen_total_mw: 100.0046281366848,
    load_total_mw: 100,
    loss_mw: 0.004628136912288028,
    termination_status: 'LOCALLY_SOLVED',
    solve_time_s: 0.018999814987182617,
    vmin_pu: 1.0499449512306664,
    vmin_bus: 'bus-2',
    violation_buses: [],
    overloaded_branches: [],
    lmp_min_yuan_per_mwh: 12.285755543363376,
    lmp_min_bus: 'bus-1',
    lmp_max_yuan_per_mwh: 12.287029284773299,
    lmp_max_bus: 'bus-2',
  };
  return {
    status: 'ok',
    type: 'opf',
    objective: {
      termination_status: 'LOCALLY_SOLVED',
      solve_time_s: 0.018999814987182617,
      cost_total_yuan_per_h: 1221.4854320616457,
    },
    summary,
    buses: [
      { id: 'bus-1', vm_pu: 1.0499993545881259, va_deg: 0, vmin_pu: 0.95, vmax_pu: 1.05, violation: null, lmp_yuan_per_mwh: 12.285755543363376 },
      { id: 'bus-2', vm_pu: 1.0499449512306664, va_deg: -0.0148, vmin_pu: 0.95, vmax_pu: 1.05, violation: null, lmp_yuan_per_mwh: 12.287029284773299 },
      { id: 'bus-3', vm_pu: 1.0499858460596565, va_deg: -0.0037, vmin_pu: 0.95, vmax_pu: 1.05, violation: null, lmp_yuan_per_mwh: 12.286073955479445 },
    ],
    branches: [
      { id: 'line-12', p_mw: 57.14388857907805, q_mvar: 0.0033, p_to_mw: -57.14, q_to_mvar: 0.011, loss_mw: 0.00296, loading_pct: 28.57, status: 'CLOSED', overloaded: false },
      { id: 'line-23', p_mw: -42.859073260005346, q_mvar: -0.0114, p_to_mw: 42.86, q_to_mvar: 0.0198, loss_mw: 0.00166, loading_pct: 21.43, status: 'CLOSED', overloaded: false },
    ],
    gens: [
      gen({
        id: 'gen-1', bus: 'bus-1', pg_mw: 57.14388858042935, qg_mvar: 0.0033, pmax_mw: 100,
        cost_c2: 0.02, cost_c1: 10, cost_c0: 100, cost_yuan_per_h: 736.7473658461439,
        marginal_cost_yuan_per_mwh: 12.285755543217174, binding: false,
      }),
      gen({
        id: 'gen-2', bus: 'bus-3', pg_mw: 42.86073955625546, qg_mvar: 0.0198, pmax_mw: 100,
        cost_c2: 0.05, cost_c1: 8, cost_c0: 50, cost_yuan_per_h: 484.73806621550176,
        marginal_cost_yuan_per_mwh: 12.286073955625547, binding: false,
      }),
    ],
  };
}

describe('LMP 色标', () => {
  it('IEEE33 的 LMP 从电源 1.0000 递增到末端 1.1472：正常上色，两端蓝→红', () => {
    const d = lmpDomain([1.0000000000012583, 1.05, 1.1471924294768638])!;
    expect(d.flat).toBe(false);
    expect(d.lo).toBeCloseTo(1.0, 9);
    expect(d.hi).toBeCloseTo(1.1471924294768638, 9);
    expect(lmpColor(d.lo, d)).toBe('rgb(37, 99, 235)');
    expect(lmpColor(d.hi, d)).toBe('rgb(220, 38, 38)');
    // 中间母线必须是可区分的第三种颜色（否则热力图没意义）
    expect(lmpColor(1.05, d)).not.toBe(lmpColor(d.lo, d));
  });

  it('econ2 全网 LMP 几乎相等（相对极差 1.0e-4）→ 判定为退化，统一中性灰，不除以零', () => {
    const d = opfLmpDomain(econ2())!;
    expect(d.rel).toBeLessThan(LMP_FLAT_REL);
    expect(d.flat).toBe(true);
    // 退化时所有母线一个颜色，且不是色标两端的蓝/红（不给出误导性的价差观感）
    expect(lmpColor(d.lo, d)).toBe('#94a3b8');
    expect(lmpColor(d.hi, d)).toBe('#94a3b8');
  });

  it('完全相等（单母线 / 零极差）不产生 NaN，也判为退化', () => {
    const d = lmpDomain([50, 50, 50])!;
    expect(d.rel).toBe(0);
    expect(d.flat).toBe(true);
    expect(lmpColor(50, d)).toBe('#94a3b8');
    expect(lmpDomain([])).toBeNull();
    expect(lmpColor(1, null)).toBe('#94a3b8');
  });

  it('全零 LMP 不除以零', () => {
    const d = lmpDomain([0, 0])!;
    expect(Number.isFinite(d.rel)).toBe(true);
    expect(d.flat).toBe(true);
  });
});

describe('边际机组 / 顶限判定', () => {
  it('未顶限 = 边际机组；其边际成本等于所在母线 LMP（econ2 实测）', () => {
    const res = econ2();
    const g1 = res.gens[0];
    expect(isMarginalGen(g1)).toBe(true);
    // gen-1 @ bus-1：12.285755543217174 vs LMP 12.285755543363376
    expect(marginalMatchesLmp(g1.marginal_cost_yuan_per_mwh, res.buses[0].lmp_yuan_per_mwh)).toBe(true);
    // gen-2 @ bus-3：12.286073955625547 vs LMP 12.286073955479445
    const g2 = res.gens[1];
    expect(marginalMatchesLmp(g2.marginal_cost_yuan_per_mwh, res.buses[2].lmp_yuan_per_mwh)).toBe(true);
    // 但 gen-2 的边际成本 ≠ bus-1 的 LMP 吗？两者差 3e-4 元/MWh，相对 2.6e-5 —— 无阻塞时全网被拉平，
    // 这正是「等微增率」：所以这里不断言不等，只断言它对自己母线成立。
  });

  it('顶限机组退出定价：binding=true 时边际成本与 LMP 不相等', () => {
    const capped = gen({ id: 'gen-x', pg_mw: 100, pmax_mw: 100, at_pmax: true, binding: true, marginal_cost_yuan_per_mwh: 8 });
    expect(isMarginalGen(capped)).toBe(false);
    expect(bindingLabel(capped)).toBe('顶上限 Pmax');
    expect(marginalMatchesLmp(capped.marginal_cost_yuan_per_mwh, 12.3)).toBe(false);
    const floored = gen({ at_pmin: true, binding: true, pg_mw: 0 });
    expect(bindingLabel(floored)).toBe('顶下限 Pmin');
    expect(bindingLabel(gen({}))).toBe('未顶限');
  });

  it('LMP 缺失时不误判为「相等」', () => {
    expect(marginalMatchesLmp(12, undefined)).toBe(false);
    expect(marginalMatchesLmp(NaN, 12)).toBe(false);
  });
});

describe('成本格式化', () => {
  it('元/h 与 元/MWh 保留位数', () => {
    expect(fmtYuan(1221.4854320616457)).toBe('1221.49');
    expect(fmtYuan(12.285755543363376, 4)).toBe('12.2858');
    expect(fmtYuan(null)).toBe('—');
    expect(fmtYuan(undefined, 4)).toBe('—');
  });

  it('isDefaultCostCurve 精确识别后端默认曲线 c₂=0, c₁=1, c₀=0', () => {
    expect(isDefaultCostCurve({ cost_c2: 0, cost_c1: 1, cost_c0: 0 })).toBe(true);
    expect(isDefaultCostCurve({ cost_c2: 0.02, cost_c1: 10, cost_c0: 100 })).toBe(false);
    expect(isDefaultCostCurve({ cost_c2: 0, cost_c1: 1, cost_c0: 50 })).toBe(false);
    expect(isDefaultCostCurve({ cost_c2: 0, cost_c1: 0, cost_c0: 0 })).toBe(false); // 真的免费，不是默认值
  });
});

describe('renderOpf', () => {
  it('概览给出总成本 / 终止状态 / LMP 区间', () => {
    const res = econ2();
    renderOpf(host, res, opfLmpDomain(res));
    expect(host.textContent).toContain('1221.49 元/h');
    expect(host.textContent).toContain('LOCALLY_SOLVED');
    expect(host.textContent).toContain('12.2870'); // lmp_max
    expect(host.textContent).toContain('12.2858'); // lmp_min
  });

  it('LMP 退化时给出「色标已退化」的解释，而不是画一条误导性的蓝→红图例', () => {
    const res = econ2();
    renderOpf(host, res, opfLmpDomain(res));
    expect(host.querySelector('.heat-bar')).toBeNull();
    expect(host.querySelector('.note-flat')).not.toBeNull();
    expect(host.textContent).toContain('色标已退化');
  });

  it('LMP 有显著差异时才画色标图例', () => {
    const res = econ2();
    res.buses[2].lmp_yuan_per_mwh = 14; // 制造 12.2858 → 14 的价差
    renderOpf(host, res, opfLmpDomain(res));
    expect(host.querySelector('.heat-bar')).not.toBeNull();
    expect(host.querySelector('.note-flat')).toBeNull();
  });

  it('边际机组：两格（边际成本 / 母线 LMP）被并排高亮，并打上「定价」标记', () => {
    const res = econ2();
    renderOpf(host, res, opfLmpDomain(res));
    const rows = host.querySelectorAll('tbody tr.row-marginal');
    expect(rows).toHaveLength(2); // econ2 两台机都未顶限
    expect(host.querySelectorAll('td.cell-pricing')).toHaveLength(4); // 每台机 2 格
    expect(host.textContent).toContain('边际机组（定价）');
    expect(host.textContent).toContain('等微增率');
  });

  it('顶限机组：标出 Pmax 且不高亮定价格，说明里点名它不参与定价', () => {
    const res = econ2();
    res.gens[1] = gen({
      id: 'gen-2', bus: 'bus-3', pg_mw: 100, pmax_mw: 100, at_pmax: true, binding: true,
      marginal_cost_yuan_per_mwh: 18, cost_yuan_per_h: 1350,
    });
    renderOpf(host, res, opfLmpDomain(res));
    expect(host.querySelectorAll('tbody tr.row-binding')).toHaveLength(1);
    expect(host.textContent).toContain('顶上限 Pmax');
    expect(host.textContent).toContain('不参与定价');
    // 顶限机组的两格不能被高亮成「在定价」
    expect(host.querySelectorAll('td.cell-pricing')).toHaveLength(2); // 只剩 gen-1 的两格
  });

  it('母线表给出 Vm / Va / LMP', () => {
    const res = econ2();
    renderOpf(host, res, opfLmpDomain(res));
    const tables = Array.from(host.querySelectorAll('table'));
    const busRows = tables[tables.length - 1].querySelectorAll('tbody tr');
    expect(busRows).toHaveLength(3);
    const cells = Array.from(busRows[1].querySelectorAll('td')).map((td) => td.textContent?.trim());
    expect(cells[1]).toBe('bus-2');
    expect(cells[2]).toBe('1.0499'); // vm_pu
    expect(cells[4]).toBe('12.2870'); // LMP
  });

  it('LMP 区间按 min → max 方向读（与图例、历史记录一致；IEEE33 的教学结论是「从电源侧向末端递增」）', () => {
    const res = econ2();
    renderOpf(host, res, opfLmpDomain(res));
    const stat = Array.from(host.querySelectorAll('.stat')).find((el) =>
      el.textContent?.includes('LMP 区间'),
    )!;
    expect(stat.querySelector('.stat-value')?.textContent?.trim()).toBe('12.2858 → 12.2870');
    // stat-sub 的顺序必须跟着一起翻：先最便宜（=min），后最贵（=max）
    const sub = stat.querySelector('.stat-sub')?.textContent ?? '';
    expect(sub.indexOf('最便宜 bus-1')).toBeGreaterThanOrEqual(0);
    expect(sub.indexOf('最便宜 bus-1')).toBeLessThan(sub.indexOf('最贵 bus-2'));
  });

  it('表里显示 c₂ / c₁ / c₀ 三列（学生要能看见调度是按哪条成本曲线算的）', () => {
    const res = econ2();
    renderOpf(host, res, opfLmpDomain(res));
    const row = host.querySelectorAll('tbody tr')[0];
    const c = Array.from(row.querySelectorAll('td')).map((td) => td.textContent?.trim());
    expect(c[5]).toBe('0.0200'); // cost_c2
    expect(c[6]).toBe('10.0000'); // cost_c1
    expect(c[7]).toBe('100.00'); // cost_c0
  });

  it('「只给一台机填成本」：默认成本机组被点名（否则它白捡 c₁=1，顶到 Pmax，还被包装成权威结论）', () => {
    const res = econ2();
    // 后端对没填成本的机组硬编码 c₂=0, c₁=1, c₀=0，并把它顶到 Pmax（活后端实测）
    res.gens[1] = gen({
      id: 'gen-2', bus: 'bus-3', pg_mw: 100, pmax_mw: 100, at_pmax: true, binding: true,
      cost_c2: 0, cost_c1: 1, cost_c0: 0, cost_yuan_per_h: 100,
      marginal_cost_yuan_per_mwh: 1,
    });
    renderOpf(host, res, opfLmpDomain(res));
    expect(host.querySelectorAll('tbody tr.row-defaulted')).toHaveLength(1);
    expect(host.querySelectorAll('.tag-defaulted')).toHaveLength(1);
    const warn = host.querySelector('.note-warn');
    expect(warn).not.toBeNull();
    expect(warn!.textContent).toContain('gen-2');
    expect(warn!.textContent).toContain('c₂=0, c₁=1, c₀=0');
    expect(warn!.textContent).toContain('结论不成立');
    // 有真实成本的 gen-1 不能被误标
    expect(host.querySelectorAll('tbody tr')[0].className).not.toContain('row-defaulted');
  });

  it('全部机组都没成本（IEEE33 的 grid-1）→ 说明 LMP 绝对值是归一化出来的假数', () => {
    const res = econ2();
    res.gens = res.gens.map((g) => gen({ ...g, cost_c2: 0, cost_c1: 1, cost_c0: 0 }));
    renderOpf(host, res, opfLmpDomain(res));
    const warn = host.querySelector('.note-warn')!;
    expect(warn.textContent).toContain('绝对值');
    expect(warn.textContent).toContain('相对差');
  });

  it('机组都填了成本 → 不出现「默认成本」告警（不能天天狼来了）', () => {
    const res = econ2();
    renderOpf(host, res, opfLmpDomain(res));
    expect(host.querySelector('.note-warn')).toBeNull();
    expect(host.querySelectorAll('.tag-defaulted')).toHaveLength(0);
  });

  it('机组 / 母线 id 里的 HTML 被转义', () => {
    const res = econ2();
    res.gens[0].id = 'gen<img src=x onerror=alert(1)>';
    res.buses[0].id = '<script>alert(1)</script>';
    renderOpf(host, res, opfLmpDomain(res));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('gen<img src=x onerror=alert(1)>');
    expect(host.textContent).toContain('<script>alert(1)</script>');
  });
});
