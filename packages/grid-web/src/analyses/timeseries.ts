// 时序潮流结果视图：双 y 轴曲线（网损 kW / 最低电压 pu）+ 表 + 越限点数。
import { mountChart } from '../chart';
import type { ChartSeries } from '../chart';
import { esc, fmt } from './format';
import type { TimeseriesResult } from '../types';

const LOSS_COLOR = '#2563eb';
const VMIN_COLOR = '#d97706';

export function renderTimeseries(container: HTMLElement, res: TimeseriesResult): () => void {
  const s = res.summary;
  const ok = res.points.filter((p) => p.outcome === 'ok');
  const violationPoints = ok.filter((p) => (p.violation_count ?? 0) > 0).length;
  const diverged = res.points.length - ok.length;
  container.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'result-head';
  head.innerHTML = `<h3>时序潮流</h3><span class="muted small">对每个负荷倍数各做一次 AC 潮流（全网负荷等比缩放），共 ${s.n_points} 点。</span>`;
  container.appendChild(head);

  const stats = document.createElement('div');
  stats.className = 'stat-grid';
  stats.innerHTML = `
    <div class="stat"><span class="stat-label">最大网损</span><span class="stat-value">${
      s.max_loss_mw === null ? '—' : fmt(s.max_loss_mw * 1000, 1)
    } kW</span></div>
    <div class="stat ${
      s.min_vmin_pu !== null && s.min_vmin_pu < 0.95 ? 'stat-bad' : 'stat-good'
    }"><span class="stat-label">全程最低电压</span><span class="stat-value">${
      s.min_vmin_pu === null ? '—' : fmt(s.min_vmin_pu, 4)
    } pu</span></div>
    <div class="stat ${violationPoints ? 'stat-bad' : 'stat-good'}"><span class="stat-label">越限点数</span><span class="stat-value">${violationPoints}</span><span class="stat-sub">/ ${
      res.points.length
    } 点</span></div>
    <div class="stat ${diverged ? 'stat-bad' : ''}"><span class="stat-label">不收敛点</span><span class="stat-value">${diverged}</span></div>
  `;
  container.appendChild(stats);

  // X 轴切换：负荷倍数（默认，按倍数升序）/ 点序号（保留输入顺序，适合典型日曲线）
  const bar = document.createElement('div');
  bar.className = 'view-switch';
  bar.innerHTML = `
    <span class="muted small">X 轴</span>
    <label><input type="radio" name="ts-x" value="scale" checked /> 负荷倍数</label>
    <label><input type="radio" name="ts-x" value="index" /> 点序号（输入顺序）</label>
  `;
  container.appendChild(bar);

  const chartHost = document.createElement('div');
  chartHost.className = 'chart-host';
  container.appendChild(chartHost);

  let dispose: (() => void) | null = null;
  const drawChart = (mode: 'scale' | 'index') => {
    dispose?.();
    const sorted = mode === 'scale' ? [...ok].sort((a, b) => a.scale - b.scale) : ok;
    const xOf = (i: number) => (mode === 'scale' ? sorted[i].scale : res.points.indexOf(sorted[i]) + 1);
    const series: ChartSeries[] = [
      {
        id: 'loss',
        label: '网损',
        color: LOSS_COLOR,
        unit: 'kW',
        digits: 1,
        points: sorted.map((p, i) => ({ x: xOf(i), y: (p.loss_mw ?? 0) * 1000 })),
      },
      {
        id: 'vmin',
        label: '最低电压',
        color: VMIN_COLOR,
        axis: 'right',
        unit: 'pu',
        digits: 4,
        points: sorted.map((p, i) => ({ x: xOf(i), y: p.vmin_pu ?? 0 })),
      },
    ];
    dispose = mountChart(chartHost, {
      series,
      height: 250,
      xLabel: mode === 'scale' ? '负荷倍数 (×)' : '点序号',
      xUnit: mode === 'scale' ? '×' : '',
      xDigits: mode === 'scale' ? 2 : 0,
      yLabelLeft: '网损 (kW)',
      yLabelRight: '最低电压 (pu)',
    });
  };
  drawChart('scale');
  bar.querySelectorAll('input[name="ts-x"]').forEach((input) => {
    input.addEventListener('change', () => drawChart((input as HTMLInputElement).value as 'scale' | 'index'));
  });

  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr><th>#</th><th>负荷倍数</th><th>结果</th><th>网损 (kW)</th><th>最低电压 (pu)</th><th>越限母线数</th></tr></thead>
    <tbody>
      ${res.points
        .map((p, i) => {
          const bad = p.outcome !== 'ok' || (p.violation_count ?? 0) > 0;
          return `<tr class="${bad ? 'row-bad' : ''}">
            <td>${i + 1}</td>
            <td>${fmt(p.scale, 2)}×</td>
            <td>${p.outcome === 'ok' ? '<span class="tag tag-ok">收敛</span>' : '<span class="tag tag-diverged">不收敛</span>'}</td>
            <td>${p.loss_mw === undefined ? '—' : fmt(p.loss_mw * 1000, 1)}</td>
            <td>${p.vmin_pu === undefined ? '—' : `${fmt(p.vmin_pu, 4)}${p.vmin_bus ? ` @ ${esc(p.vmin_bus)}` : ''}`}</td>
            <td>${p.violation_count ?? '—'}</td>
          </tr>`;
        })
        .join('')}
    </tbody>
  `;
  wrap.appendChild(table);
  container.appendChild(wrap);

  return () => dispose?.();
}
