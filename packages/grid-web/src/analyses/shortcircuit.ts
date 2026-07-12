// 短路计算结果视图。
// 教学坑：slack 母线的 Zth 被约定为 j·1e-6 pu（理想无穷大电源），算出的 I_f ≈ 4.6e5 kA、
// S_sc ≈ 1e7 MVA 是**建模约定的产物，不是物理真值**。这里必须
//   (1) 把该行灰显并明确标注；
//   (2) 把它排除在热力色标定标之外，否则其余母线会全部挤成同一个颜色。
import {
  esc,
  fmt,
  fmtSci,
  fmtZth,
  heatColor,
  heatDomain,
  IDEAL_SOURCE_NOTE,
  isIdealSourceRow,
  realMaxRow,
  summarizeMaxBus,
} from './format';
import type { ShortCircuitResult } from '../types';

export interface ShortCircuitHooks {
  onHoverBus(bus: string | null): void;
}

export function renderShortCircuit(
  container: HTMLElement,
  res: ShortCircuitResult,
  slackBusId: string | null,
  hooks: ShortCircuitHooks,
): void {
  container.innerHTML = '';
  const rows = res.results;
  const domain = heatDomain(rows, slackBusId);
  const maxInfo = summarizeMaxBus(rows, res.summary.max_bus, slackBusId);
  const realMax = realMaxRow(rows, slackBusId);
  const minRow = rows.find((r) => r.bus === res.summary.min_bus);
  const idealCount = rows.filter((r) => isIdealSourceRow(r, slackBusId)).length;

  const head = document.createElement('div');
  head.className = 'result-head';
  head.innerHTML = `<h3>短路计算（三相金属性/经阻抗，戴维南等值）</h3><span class="muted small">Zth 由含机组暂态电抗 X′d 与 slack 源阻抗的 Y-bus 求逆取对角元；I_f = V_pre / (Zth + Zf)。</span>`;
  container.appendChild(head);

  const stats = document.createElement('div');
  stats.className = 'stat-grid';
  stats.innerHTML = `
    <div class="stat"><span class="stat-label">最大短路电流母线</span><span class="stat-value">${esc(
      maxInfo.bus,
    )}</span><span class="stat-sub">${
      maxInfo.ideal
        ? `${fmtSci(res.summary.max_i_f_ka)} kA — ${IDEAL_SOURCE_NOTE}`
        : `${fmt(res.summary.max_i_f_ka, 2)} kA`
    }</span></div>
    ${
      maxInfo.ideal && realMax
        ? `<div class="stat stat-bad"><span class="stat-label">最大（排除理想电源）</span><span class="stat-value">${esc(
            realMax.bus,
          )}</span><span class="stat-sub">${fmt(realMax.i_f_ka, 2)} kA · ${fmt(realMax.s_sc_mva, 1)} MVA</span></div>`
        : ''
    }
    <div class="stat"><span class="stat-label">最小短路电流母线</span><span class="stat-value">${esc(
      res.summary.min_bus,
    )}</span><span class="stat-sub">${fmt(res.summary.min_i_f_ka, 3)} kA${
      minRow ? ` · ${fmt(minRow.s_sc_mva, 2)} MVA` : ''
    }</span></div>
    <div class="stat"><span class="stat-label">故障点数</span><span class="stat-value">${rows.length}</span><span class="stat-sub">${
      idealCount ? `含 ${idealCount} 个理想电源节点（已灰显）` : '全部为真实值'
    }</span></div>
  `;
  container.appendChild(stats);

  if (idealCount > 0) {
    const warn = document.createElement('p');
    warn.className = 'note-warn';
    warn.innerHTML = `⚠ 平衡节点按<strong>理想无穷大电源</strong>建模（Zth = j·1e-6 pu），其 I_f / S_sc 是<strong>约定产物而非物理真值</strong>；下表已灰显该行，画布热力色标也已把它排除在定标之外。`;
    container.appendChild(warn);
  }

  if (domain) {
    const legend = document.createElement('div');
    legend.className = 'heat-legend';
    legend.innerHTML = `
      <span class="muted small">画布母线着色（短路电流）</span>
      <span class="heat-bar"></span>
      <span class="small mono">${fmt(domain[0], 2)} kA</span>
      <span class="muted small">→</span>
      <span class="small mono">${fmt(domain[1], 2)} kA</span>
    `;
    container.appendChild(legend);
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table hoverable';
  table.innerHTML = `
    <thead><tr>
      <th></th><th>母线</th><th>故障前电压 (pu)</th><th>Zth = r + jx (pu)</th>
      <th>I_f (pu)</th><th>I_f (kA)</th><th>S_sc (MVA)</th><th>备注</th>
    </tr></thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody') as HTMLElement;
  for (const row of rows) {
    const ideal = isIdealSourceRow(row, slackBusId);
    const tr = document.createElement('tr');
    tr.className = ideal ? 'row-ideal' : '';
    const color = ideal ? '#cbd5e1' : heatColor(row.i_f_ka, domain);
    tr.innerHTML = `
      <td><span class="swatch" style="background:${color}"></span></td>
      <td><code>${esc(row.bus)}</code></td>
      <td>${fmt(row.v_prefault_pu, 4)}</td>
      <td class="mono">${fmtZth(row.zth_pu)}</td>
      <td>${fmtSci(row.i_f_pu, 3)}</td>
      <td>${fmtSci(row.i_f_ka, 2)}</td>
      <td>${fmtSci(row.s_sc_mva, 1)}</td>
      <td class="muted small">${ideal ? IDEAL_SOURCE_NOTE : ''}</td>
    `;
    tr.addEventListener('mouseenter', () => hooks.onHoverBus(row.bus));
    tr.addEventListener('mouseleave', () => hooks.onHoverBus(null));
    tbody.appendChild(tr);
  }
  wrap.appendChild(table);
  container.appendChild(wrap);
}
