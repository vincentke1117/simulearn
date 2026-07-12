// 暂态稳定结果视图：稳定徽章 + CCT + 功角 δ(t) 多机曲线 + 角速度 ω(t) + 机组参数表。
import { mountChart } from '../chart';
import type { ChartMarker, ChartSeries } from '../chart';
import { esc, fmt } from './format';
import type { TransientResult } from '../types';

const PALETTE = ['#2563eb', '#dc2626', '#15803d', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#0f766e'];

/**
 * @param fHz 本次仿真实际使用的系统频率（来自请求参数，后端不回显 f_hz）。
 *            CCT 的周波换算必须跟着它走，不能写死 50。
 */
export function renderTransient(container: HTMLElement, res: TransientResult, fHz = 50): () => void {
  container.innerHTML = '';
  const f = res.fault;
  const ids = Object.keys(res.series.delta_deg);
  const colorOf = (i: number) => PALETTE[i % PALETTE.length];

  const head = document.createElement('div');
  head.className = 'result-head';
  head.innerHTML = `<h3>暂态稳定（经典模型 / 等面积）</h3><span class="muted small">故障母线 <code>${esc(
    f.bus,
  )}</code> · t_fault ${fmt(f.t_fault_s, 3)} s · t_clear ${fmt(f.t_clear_s, 3)} s · zf ${fmt(
    f.zf_pu,
    3,
  )} pu · 跳闸支路 ${f.trip_branch ? esc(f.trip_branch) : '无'} · f ${fmt(fHz, 0)} Hz</span>`;
  container.appendChild(head);

  const stats = document.createElement('div');
  stats.className = 'stat-grid';
  const hasCct = typeof res.cct_s === 'number' && Number.isFinite(res.cct_s);
  const cctCard = hasCct
    ? `<div class="stat"><span class="stat-label">临界切除时间 CCT</span><span class="stat-value">${fmt(
        res.cct_s,
        3,
      )} s</span><span class="stat-sub">≈ ${fmt((res.cct_s as number) * fHz, 1)} 周波 @${fmt(
        fHz,
        0,
      )} Hz</span></div>`
    : `<div class="stat"><span class="stat-label">临界切除时间 CCT</span><span class="stat-value">—</span><span class="stat-sub">未开启 CCT 搜索</span></div>`;
  const margin =
    hasCct
      ? `<div class="stat ${
          f.t_clear_s - f.t_fault_s <= (res.cct_s as number) ? 'stat-good' : 'stat-bad'
        }"><span class="stat-label">切除时间裕度</span><span class="stat-value">${fmt(
          (res.cct_s as number) - (f.t_clear_s - f.t_fault_s),
          3,
        )} s</span><span class="stat-sub">CCT − 实际故障持续 ${fmt(f.t_clear_s - f.t_fault_s, 3)} s</span></div>`
      : `<div class="stat"><span class="stat-label">故障持续时间</span><span class="stat-value">${fmt(
          f.t_clear_s - f.t_fault_s,
          3,
        )} s</span></div>`;
  stats.innerHTML = `
    <div class="stat ${res.stable ? 'stat-good' : 'stat-bad'}">
      <span class="stat-label">稳定判定</span>
      <span class="stat-value">${res.stable ? '✓ 稳定' : '✗ 失稳'}</span>
      <span class="stat-sub">${
        res.stable ? '功角摇摆收敛' : `失稳时刻 t = ${fmt(res.t_unstable_s, 3)} s`
      }</span>
    </div>
    ${cctCard}
    ${margin}
    <div class="stat"><span class="stat-label">机组数</span><span class="stat-value">${
      res.machines.length
    }</span><span class="stat-sub">${res.series.t_s.length} 个采样点</span></div>
  `;
  container.appendChild(stats);

  const markers: ChartMarker[] = [
    { x: f.t_fault_s, label: `故障 ${fmt(f.t_fault_s, 2)}s`, color: '#dc2626' },
    { x: f.t_clear_s, label: `切除 ${fmt(f.t_clear_s, 2)}s`, color: '#15803d' },
  ];

  const deltaHost = document.createElement('div');
  deltaHost.className = 'chart-host';
  container.appendChild(deltaHost);
  const deltaSeries: ChartSeries[] = ids.map((id, i) => ({
    id,
    label: `δ ${id}`,
    color: colorOf(i),
    unit: '°',
    digits: 2,
    points: res.series.t_s.map((t, k) => ({ x: t, y: res.series.delta_deg[id][k] })),
  }));
  const disposeDelta = mountChart(deltaHost, {
    series: deltaSeries,
    markers,
    height: 260,
    xLabel: '时间 t (s)',
    xUnit: 's',
    yLabelLeft: '功角 δ (°)',
  });

  const omegaHost = document.createElement('div');
  omegaHost.className = 'chart-host';
  container.appendChild(omegaHost);
  const omegaSeries: ChartSeries[] = ids.map((id, i) => ({
    id,
    label: `ω ${id}`,
    color: colorOf(i),
    unit: 'pu',
    digits: 5,
    dashed: true,
    points: res.series.t_s.map((t, k) => ({ x: t, y: res.series.omega_pu[id][k] })),
  }));
  const disposeOmega = mountChart(omegaHost, {
    series: omegaSeries,
    markers,
    height: 220,
    xLabel: '时间 t (s)',
    xUnit: 's',
    yLabelLeft: '角速度 ω (pu)',
  });

  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr><th>机组</th><th>H (s)</th><th>X'd (pu)</th><th>δ₀ (°)</th><th>Pm (pu)</th><th>δ 峰值 (°)</th></tr></thead>
    <tbody>
      ${res.machines
        .map((mch, i) => {
          const trace = res.series.delta_deg[mch.id] ?? [];
          const peak = trace.length ? Math.max(...trace) : NaN;
          return `<tr>
            <td><span class="swatch" style="background:${colorOf(i)}"></span><code>${esc(mch.id)}</code></td>
            <td>${fmt(mch.h_s, 2)}</td>
            <td>${fmt(mch.xd1_pu, 3)}</td>
            <td>${fmt(mch.delta0_deg, 2)}</td>
            <td>${fmt(mch.pm_pu, 3)}</td>
            <td>${fmt(peak, 1)}</td>
          </tr>`;
        })
        .join('')}
    </tbody>
  `;
  wrap.appendChild(table);
  container.appendChild(wrap);

  const note = document.createElement('p');
  note.className = 'muted small';
  note.textContent =
    'δ 为发电机内电势相对同步参考系的功角；ω 为转子角速度（1.0 pu = 同步转速）。失稳判据：任一机组 δ 相对参考机超出阈值。';
  container.appendChild(note);

  return () => {
    disposeDelta();
    disposeOmega();
  };
}
