// @vitest-environment jsdom
// 结果视图的 DOM 渲染回归（此前只有纯函数有单测，渲染路径靠人肉浏览器验证）。
import { beforeEach, describe, expect, it } from 'vitest';
import { renderN1 } from './n1';
import { renderShortCircuit } from './shortcircuit';
import { renderTransient } from './transient';
import type { N1Result, ShortCircuitResult, TransientResult } from '../types';

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
