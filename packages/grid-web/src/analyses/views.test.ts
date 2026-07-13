// @vitest-environment jsdom
// 结果视图的 DOM 渲染回归（此前只有纯函数有单测，渲染路径靠人肉浏览器验证）。
import { beforeEach, describe, expect, it } from 'vitest';
import { renderN1 } from './n1';
import { renderShortCircuit } from './shortcircuit';
import { renderTransient } from './transient';
import type { N1RestorationEntry, N1Result, ShortCircuitResult, TransientResult } from '../types';

// jsdom 不实现 ResizeObserver（chart.ts 用它做自适应重绘）。这里只补一个不触发回调的空壳，
// 图表的首帧 draw() 仍然是真实执行的，断言的也是真实 DOM。
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= NoopResizeObserver;

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

const cells = (tr: Element) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '');

// 结构取自后端 analysis.jl::execute_n1 的三种分支（ok / islanding / diverged）
function n1Result(): N1Result {
  return {
    type: 'n1',
    results: [
      {
        branch: 'line-1',
        outcome: 'ok',
        loss_mw: 0.2,
        vmin_pu: 0.95,
        vmin_bus: 'bus-18',
        violation_buses: [],
      },
      { branch: 'line-2', outcome: 'islanding', islanded_buses: ['bus-3'], lost_load_mw: 1.234 },
      // diverged 行后端只回 {branch, outcome} —— 没有 lost_load_mw
      { branch: 'line-3', outcome: 'diverged' },
    ],
    summary: {
      n_branches: 3,
      n_islanding: 1,
      n_ok: 1,
      n_diverged: 1,
      max_lost_load_mw: 1.234,
      worst_branch: 'line-2',
    },
  };
}

describe('renderN1', () => {
  it('diverged 行的失负荷是「未知」而不是 0.000（后端根本没给这个字段）', () => {
    renderN1(host, n1Result(), { onHoverBranch: () => {} });
    const rows = host.querySelectorAll('tbody tr');
    expect(cells(rows[0])[2]).toBe('0.000'); // ok：确实没有失负荷
    expect(cells(rows[1])[2]).toBe('1.234'); // islanding：后端给的值
    expect(cells(rows[2])[2]).toBe('未知'); // diverged：不能谎报 0
    expect(rows[2].getAttribute('title')).toContain('未知');
  });

  it('支路 id 里的 HTML 被转义，不会注入元素', () => {
    const res = n1Result();
    res.results[0].branch = 'bus-1<img src=x onerror=alert(1)>';
    res.summary.worst_branch = res.results[0].branch;
    renderN1(host, res, { onHoverBranch: () => {} });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('tbody tr code')?.textContent).toBe('bus-1<img src=x onerror=alert(1)>');
  });
});

// ---- N-1 转供恢复（结构与数值取自 .samples/grid-n1-restore.json，IEEE-33）----

const restorationEntry = (over: Partial<N1RestorationEntry>): N1RestorationEntry => ({
  branch: 'br-2',
  restorable: true,
  fully_restored: true,
  reason: null,
  islanded_buses: ['bus-3', 'bus-4'],
  islanded_buses_after: [],
  lost_load_before_mw: 3.255000000000001,
  lost_load_after_mw: 0,
  candidate_ties: ['br-33', 'br-34', 'br-35', 'br-36', 'br-37'],
  closed_ties: ['br-33'],
  n_candidates_evaluated: 5,
  search_depth: 1,
  max_search_depth: 1,
  loss_mw: 0.8936669676554889,
  vmin_pu: 0.745611112492971,
  vmin_bus: 'bus-33',
  violated: true,
  violation_buses: ['bus-3', 'bus-4', 'bus-5'],
  overloaded_branches: [],
  radial: true,
  n_closed_branches: 32,
  n_loops_base: 0,
  n_loops_after: 0,
  n_bus: 33,
  ...over,
});

/** br-1：电源出线，5 条候选联络开关两端都在孤岛里 → 不可恢复，恢复后字段全 null。 */
const unrestorable = (): N1RestorationEntry =>
  restorationEntry({
    branch: 'br-1',
    restorable: false,
    fully_restored: false,
    reason:
      'no tie switch bridges the energized network and the islanded section (every tie has both ends inside the island — the outage isolates the source feeder)',
    islanded_buses: ['bus-2', 'bus-3'],
    islanded_buses_after: ['bus-2', 'bus-3'],
    lost_load_before_mw: 3.715,
    lost_load_after_mw: 3.715,
    closed_ties: [],
    loss_mw: null,
    vmin_pu: null,
    vmin_bus: null,
    violated: null,
    violation_buses: [],
    radial: null,
    n_closed_branches: null,
    n_loops_after: null,
  });

function n1RestoreResult(): N1Result {
  return {
    type: 'n1_analysis',
    results: [
      { branch: 'br-1', outcome: 'islanding', islanded_buses: ['bus-2', 'bus-3'], lost_load_mw: 3.715 },
      { branch: 'br-2', outcome: 'islanding', islanded_buses: ['bus-3', 'bus-4'], lost_load_mw: 3.255000000000001 },
      // br-17：可恢复且恢复后合格（vmin 0.9122 > 0.9）
      { branch: 'br-17', outcome: 'islanding', islanded_buses: ['bus-18'], lost_load_mw: 0.09 },
    ],
    restoration: [
      unrestorable(),
      restorationEntry({}),
      restorationEntry({
        branch: 'br-17',
        islanded_buses: ['bus-18'],
        lost_load_before_mw: 0.09,
        closed_ties: ['br-36'],
        loss_mw: 0.20276755359886156,
        vmin_pu: 0.9121854504049769,
        vmin_bus: 'bus-18',
        violated: false,
        violation_buses: [],
      }),
    ],
    summary: {
      n_branches: 32,
      n_islanding: 32,
      n_ok: 0,
      n_diverged: 0,
      max_lost_load_mw: 3.715,
      worst_branch: 'br-1',
      n_restorable: 31,
      n_unrestorable: 1,
      max_search_depth: 1,
      n_loops_base: 0,
    },
  };
}

describe('renderN1 + 转供恢复', () => {
  it('不可恢复行的 null 字段显示成「—」，绝不能显示成 0', () => {
    renderN1(host, n1RestoreResult(), { onHoverBranch: () => {} });
    const row = host.querySelectorAll('tbody tr')[0]; // br-1
    const c = cells(row);
    expect(c[0]).toBe('br-1');
    expect(c[4]).toBe('不可恢复');
    expect(c[5]).toBe('—'); // 闭合联络开关：没有
    expect(c[6]).toBe('—'); // 恢复后网损 loss_mw = null
    expect(c[7]).toBe('—'); // 恢复后 vmin = null
    expect(c[8]).toBe('—'); // violated = null
    expect(c[9]).toBe('3.715'); // 剩余失负荷：仍然全失
    expect(c[6]).not.toBe('0.0');
    expect(c[7]).not.toBe('0.0000');
  });

  it('不可恢复行诚实展示 reason 与「5 条候选全试过」', () => {
    renderN1(host, n1RestoreResult(), { onHoverBranch: () => {} });
    const row = host.querySelectorAll('tbody tr')[0];
    expect(row.textContent).toContain('every tie has both ends inside the island');
    expect(row.textContent).toContain('5 条候选联络开关全部试过');
    expect(row.getAttribute('title')).toContain('br-33');
  });

  it('「可恢复但越限」行被醒目标记（row-conflict）并在概览上方给出教学提示', () => {
    renderN1(host, n1RestoreResult(), { onHoverBranch: () => {} });
    const conflict = host.querySelectorAll('tbody tr.row-conflict');
    expect(conflict).toHaveLength(1);
    expect(cells(conflict[0])[0]).toBe('br-2');
    const c = cells(conflict[0]);
    expect(c[4]).toBe('完全恢复');
    expect(c[5]).toBe('br-33');
    expect(c[7]).toContain('0.7456'); // 恢复后 vmin
    expect(c[8]).toContain('越限');
    expect(c[9]).toBe('0.000'); // 剩余失负荷归零
    // 概览与提示条
    expect(host.textContent).toContain('能供上电 ≠ 供得好');
    expect(host.textContent).toContain('网络重构');
    expect(host.querySelector('.stat-grid')?.textContent).toContain('可转供恢复');
  });

  it('conflict 行不再同时挂 row-bad（否则是橙底+红字的四不像，且依赖 CSS 声明顺序）；row-bad 只留给真的供不上电的行', () => {
    renderN1(host, n1RestoreResult(), { onHoverBranch: () => {} });
    const rows = host.querySelectorAll('tbody tr');
    // br-2：可完全恢复但恢复后越限 → 只要 row-conflict
    expect(rows[1].className).toContain('row-conflict');
    expect(rows[1].className).not.toContain('row-bad');
    // br-1：不可恢复 → 仍然是 row-bad
    expect(rows[0].className).toContain('row-bad');
    expect(rows[0].className).not.toContain('row-conflict');
  });

  it('可恢复且合格的行不被标成 conflict / row-bad', () => {
    renderN1(host, n1RestoreResult(), { onHoverBranch: () => {} });
    const row = host.querySelectorAll('tbody tr')[2]; // br-17
    expect(row.className).not.toContain('row-conflict');
    expect(row.className).not.toContain('row-bad');
    expect(cells(row)[8]).toBe('合格');
  });

  it('hover 时把转供条目一并交给画布（用于高亮闭合的联络开关）', () => {
    const seen: Array<string | null> = [];
    renderN1(host, n1RestoreResult(), {
      onHoverBranch: (_entry, rest) => seen.push(rest ? rest.closed_ties.join(',') : null),
    });
    const row = host.querySelectorAll('tbody tr')[1]; // br-2
    row.dispatchEvent(new MouseEvent('mouseenter'));
    row.dispatchEvent(new MouseEvent('mouseleave'));
    expect(seen).toEqual(['br-33', null]);
  });

  it('搜索深度说明：单联络开关是充要条件，不是偷懒', () => {
    renderN1(host, n1RestoreResult(), { onHoverBranch: () => {} });
    expect(host.textContent).toContain('充要条件');
    expect(host.textContent).toContain('搜索深度 = 1');
  });

  it('不勾选转供时表格退回原来的 7 列，不出现恢复列', () => {
    renderN1(host, n1Result(), { onHoverBranch: () => {} });
    expect(host.textContent).not.toContain('可恢复？');
    expect(host.querySelectorAll('thead th')).toHaveLength(7);
  });

  it('reason 里的 HTML 被转义', () => {
    const res = n1RestoreResult();
    res.restoration![0].reason = '<img src=x onerror=alert(1)>';
    renderN1(host, res, { onHoverBranch: () => {} });
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

// 取自 .samples/grid-shortcircuit.json（IEEE-33）
function scResult(): ShortCircuitResult {
  return {
    type: 'shortcircuit',
    results: [
      {
        bus: 'bus-1',
        v_prefault_pu: 1,
        zth_pu: { r: 2.58e-26, x: 1.0000000000000002e-6 },
        i_f_pu: 999999.9999999999,
        i_f_ka: 456042.86665847205,
        s_sc_mva: 9999999.999999998,
      },
      {
        bus: 'bus-2',
        v_prefault_pu: 0.9970322597745297,
        zth_pu: { r: 0.00575259116172393, x: 0.0029334488568440852 },
        i_f_pu: 154.4025898234988,
        i_f_ka: 70.41419968260064,
        s_sc_mva: 1544.025898234988,
      },
      {
        bus: 'bus-18',
        v_prefault_pu: 0.9131,
        zth_pu: { r: 0.42, x: 0.31 },
        i_f_pu: 1.75,
        i_f_ka: 0.8,
        s_sc_mva: 175,
      },
    ],
    summary: { max_bus: 'bus-1', max_i_f_ka: 456042.86665847205, min_bus: 'bus-18', min_i_f_ka: 0.8 },
  };
}

describe('renderShortCircuit', () => {
  it('slack 行灰显（row-ideal）且概览额外给出排除理想电源后的真实最大值', () => {
    renderShortCircuit(host, scResult(), 'bus-1', { onHoverBus: () => {} });
    const ideal = host.querySelectorAll('tr.row-ideal');
    expect(ideal).toHaveLength(1);
    expect(ideal[0].textContent).toContain('bus-1');
    expect(host.textContent).toContain('最大（排除理想电源）');
    expect(host.textContent).toContain('70.41 kA');
  });

  it('母线 id 里的 HTML 被转义', () => {
    const res = scResult();
    res.results[1].bus = '<script>alert(1)</script>';
    renderShortCircuit(host, res, 'bus-1', { onHoverBus: () => {} });
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');
  });
});

function transientResult(): TransientResult {
  return {
    type: 'transient',
    stable: true,
    t_unstable_s: null,
    cct_s: 0.308,
    fault: { bus: 'bus-2', t_fault_s: 0.1, t_clear_s: 0.25, zf_pu: 0, trip_branch: null },
    machines: [{ id: 'gen-1', h_s: 5, xd1_pu: 0.3, delta0_deg: 22.46, pm_pu: 0.8 }],
    series: {
      t_s: [0, 0.1, 0.2],
      delta_deg: { 'gen-1': [22.46, 22.46, 40.1] },
      omega_pu: { 'gen-1': [1, 1, 1.002] },
    },
  };
}

describe('renderTransient', () => {
  it('CCT 的周波换算跟随实际 f_hz，而不是写死 50', () => {
    const dispose = renderTransient(host, transientResult(), 60);
    expect(host.textContent).toContain('周波 @60 Hz');
    expect(host.textContent).toContain((0.308 * 60).toFixed(1)); // 18.5
    dispose();
  });

  it('裕度 = CCT − 故障持续时长（cct_s 是持续时长，不是绝对切除时刻）', () => {
    const dispose = renderTransient(host, transientResult(), 50);
    // 0.308 − (0.25 − 0.1) = 0.158
    expect(host.textContent).toContain('0.158');
    expect(host.querySelector('.stat-good')).not.toBeNull();
    dispose();
  });

  it('机组 id 里的 HTML 被转义', () => {
    const res = transientResult();
    res.machines[0].id = 'gen<img src=x onerror=alert(1)>';
    res.series.delta_deg = { [res.machines[0].id]: [1, 2, 3] };
    res.series.omega_pu = { [res.machines[0].id]: [1, 1, 1] };
    const dispose = renderTransient(host, res, 50);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('gen<img src=x onerror=alert(1)>');
    dispose();
  });
});
